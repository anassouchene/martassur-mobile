'use client';

import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Smartphone, QrCode, Usb, ArrowRight, CheckCircle2, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import { collectWebDiagnostic, readAdbDiagnostic } from '@/lib/deviceDiagnostic';

interface Step1DetectProps {
  onComplete: (data: { sessionToken: string; challengeCode?: string; mode: string; deviceInfo?: any }) => void;
}

export const Step1Detect: React.FC<Step1DetectProps> = ({ onComplete }) => {
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [pairUrl, setPairUrl] = useState<string>('');
  const [challengeCode, setChallengeCode] = useState<string>('');
  const [qrCanvasUrl, setQrCanvasUrl] = useState<string>('');
  const [isUsbMode, setIsUsbMode] = useState<boolean>(false);
  const [usbStatus, setUsbStatus] = useState<string>('idle'); // idle, connecting, diagnosing, detected
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const [pairingSuccess, setPairingSuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hubConnectionRef = useRef<signalR.HubConnection | null>(null);
  const completedRef = useRef<boolean>(false);

  // Detect whether visitor is on a smartphone or desktop browser
  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    // iPadOS 13+ se présente comme un Mac : écran tactile = iPad.
    const isMobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
      || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
    setIsMobileDevice(isMobileRegex);

    initSession(isMobileRegex);

    return () => {
      if (hubConnectionRef.current) {
        hubConnectionRef.current.stop();
      }
    };
  }, []);

  const initSession = async (isMobile: boolean) => {
    setLoadingSession(true);
    try {
      const res = await fetch('/api/insurance-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceType: isMobile ? 'mobile' : 'desktop',
          userAgent: navigator.userAgent,
        }),
      });

      if (!res.ok) throw new Error('Impossible de créer la session');
      const data = await res.json();
      setSessionToken(data.sessionToken);
      setChallengeCode(data.challengeCode);

      // Create full verification URL for QR code
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const fullUrl = `${origin}${data.pairUrl}`;
      setPairUrl(fullUrl);

      // Render QR Code
      const qrDataUrl = await QRCode.toDataURL(fullUrl, {
        width: 256,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      setQrCanvasUrl(qrDataUrl);

      // Connect to SignalR Hub to receive real-time pairing notification from mobile
      setupSignalR(data.sessionToken);
    } catch (err) {
      console.error('Session init error:', err);
    } finally {
      setLoadingSession(false);
    }
  };

  const setupSignalR = (token: string) => {
    try {
      const connection = new signalR.HubConnectionBuilder()
        .withUrl('/hubs/session')
        .withAutomaticReconnect()
        .build();

      connection.start().then(() => {
        connection.invoke('JoinSession', token).catch(console.error);
      }).catch(console.error);

      connection.on('PhonePaired', (payload: any) => {
        if (completedRef.current) return;
        completedRef.current = true;
        setPairingSuccess(true);
        setTimeout(() => {
          onComplete({
            sessionToken: token,
            mode: 'WEB_QR',
            deviceInfo: payload.device,
          });
        }, 1200);
      });

      hubConnectionRef.current = connection;

      // Cloud proxies or browser extensions can interrupt WebSockets. Polling
      // keeps QR pairing reliable and completes the desktop automatically.
      const poll = window.setInterval(async () => {
        if (completedRef.current) return window.clearInterval(poll);
        try {
          const response = await fetch(`/api/insurance-sessions/${token}`, { cache: 'no-store' });
          if (!response.ok) return;
          const state = await response.json();
          if (state.status === 'PAIRED') {
            completedRef.current = true;
            window.clearInterval(poll);
            setPairingSuccess(true);
            window.setTimeout(() => onComplete({ sessionToken: token, mode: 'WEB_QR', deviceInfo: state.pairedDeviceInfo }), 500);
          }
        } catch { /* SignalR remains the primary channel. */ }
      }, 1500);
      window.setTimeout(() => window.clearInterval(poll), 15 * 60 * 1000);
    } catch (e) {
      console.warn('SignalR fallback error:', e);
    }
  };

  const handleMobileDirectVerify = async () => {
    if (!sessionToken) return;
    setErrorMsg('');
    const diagnostic = await collectWebDiagnostic();
    const response = await fetch(`/api/insurance-sessions/${sessionToken}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeCode,
        deviceModel: diagnostic.model || navigator.userAgent,
        os: navigator.platform,
        browser: navigator.userAgent,
        screenResolution: diagnostic.screenResolution,
        batteryLevel: diagnostic.battery?.level ?? null,
        diagnostic,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      setErrorMsg(failure.message || 'La session ne peut pas être associée. Régénérez-la.');
      return;
    }
    onComplete({
      sessionToken: sessionToken,
      mode: 'WEB_DIRECT',
      deviceInfo: {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        screen: diagnostic.screenResolution,
        diagnostic,
      },
    });
  };

  const handleUsbAdbConnect = async () => {
    setUsbStatus('connecting');
    setErrorMsg('');
    try {
      const [{ Adb, AdbDaemonTransport }, { AdbDaemonWebUsbDeviceManager }, credentialModule] = await Promise.all([
        import('@yume-chan/adb'),
        import('@yume-chan/adb-daemon-webusb'),
        import('@yume-chan/adb-credential-web'),
      ]);
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) throw new Error('WebADB est indisponible. Utilisez Chrome ou Edge sur ordinateur, en HTTPS.');
      if (!(navigator as any).usb) throw new Error('WebUSB non disponible : ouvrez ce site dans Chrome ou Edge sur ordinateur.');
      const device = await manager.requestDevice();
      if (!device) throw new Error('Aucun appareil Android ADB sélectionné.');
      const connection = await Promise.race([
        device.connect(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Connexion USB expirée. Déverrouillez le téléphone et rebranchez le câble.')), 30000)),
      ]);
      const CredentialStore = credentialModule.default;
      const credentialStore = new CredentialStore('SmartAssur Mobile');
      const transport = await Promise.race([
        AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore }),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Autorisation ADB non confirmée sur le téléphone.')), 60000)),
      ]);
      const adb = new Adb(transport);
      setUsbStatus('diagnosing');
      const { diagnostic, imeis } = await readAdbDiagnostic(adb).finally(() => adb.close().catch(() => undefined));
      const detectedBrand = diagnostic.brand || diagnostic.manufacturer || 'Android';
      const detectedModel = diagnostic.model || diagnostic.device || 'Modèle non communiqué';
      const evidenceResponse = await fetch('/api/devices/usb-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          brand: detectedBrand,
          model: detectedModel,
          serialNumber: '',
          buildProps: JSON.stringify({ androidVersion: diagnostic.androidVersion, ramGb: diagnostic.ramGb, storageGb: diagnostic.storageGb }),
          diagnostic,
          imeis,
        }),
      });
      if (!evidenceResponse.ok) throw new Error('La preuve USB n’a pas pu être enregistrée.');
      const evidence = await evidenceResponse.json();
      setUsbStatus('detected');
      completedRef.current = true;
      onComplete({
        sessionToken,
        // Sert au QR « tests de fonctionnement » de l'étape 2 (même preuve que l'appairage).
        challengeCode,
        mode: 'USB_ADB',
        deviceInfo: {
          brand: detectedBrand,
          model: detectedModel,
          marketName: diagnostic.marketName,
          androidVersion: diagnostic.androidVersion,
          ramGb: diagnostic.ramGb,
          storageGb: diagnostic.storageGb,
          verifiedViaUsb: true,
          diagnostic,
          // IMEI lu sur l'appareil : sert uniquement à préremplir l'étape 2 ; le serveur n'en garde que l'empreinte HMAC.
          usbImei: imeis[0] || null,
          usbImeisMasked: evidence.imeisMasked || [],
        },
      });
    } catch (error: any) {
      setUsbStatus('idle');
      const message = error?.name === 'NotFoundError'
        ? 'Aucun appareil ADB compatible. Activez Options développeur > Débogage USB, choisissez « Transfert de fichiers », puis débranchez/rebranchez le câble.'
        : error?.message || 'Connexion USB annulée ou refusée.';
      setErrorMsg(message);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 mb-3">
          <Sparkles className="w-3.5 h-3.5" /> Étape 1 : Détection contextuelle
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Détecter mon smartphone
        </h1>
        <p className="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed">
          Le site propose automatiquement la bonne méthode selon votre équipement.
        </p>
      </div>
      {errorMsg && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{errorMsg}</div>}

      {isMobileDevice ? (
        /* Mobile Device Direct Flow */
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 rounded-2xl p-6 sm:p-8 border border-blue-100 text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl text-white flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
            <Smartphone className="w-8 h-8" />
          </div>

          <h3 className="text-lg font-bold text-slate-900 mb-1">
            Smartphone détecté directement
          </h3>
          <p className="text-sm text-slate-600 mb-6 max-w-md mx-auto">
            Vous naviguez déjà depuis un smartphone. Aucun QR code à scanner sur votre propre écran : poursuivez en un clic.
          </p>

          <button
            onClick={handleMobileDirectVerify}
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-base shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 mx-auto transition-all active:scale-95"
          >
            <span>Vérifier ce téléphone</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      ) : (
        /* Desktop Flow (QR Code or USB Android) */
        <div className="space-y-6">
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs sm:text-sm font-semibold max-w-sm mx-auto">
            <button
              onClick={() => setIsUsbMode(false)}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${
                !isUsbMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <QrCode className="w-4 h-4 text-blue-600" />
              <span>Scanner QR Code</span>
            </button>
            <button
              onClick={() => setIsUsbMode(true)}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${
                isUsbMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Usb className="w-4 h-4 text-indigo-600" />
              <span>USB Android (Avancé)</span>
            </button>
          </div>

          {!isUsbMode ? (
            /* QR Code Section */
            <div className="text-center">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 inline-block relative shadow-sm">
                {loadingSession ? (
                  <div className="w-56 h-56 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                    <span className="text-xs">Génération du QR sécurisé...</span>
                  </div>
                ) : pairingSuccess ? (
                  <div className="w-56 h-56 flex flex-col items-center justify-center gap-3 text-emerald-600 bg-emerald-50 rounded-xl">
                    <CheckCircle2 className="w-14 h-14 animate-bounce" />
                    <span className="text-sm font-bold">Smartphone appairé !</span>
                  </div>
                ) : (
                  <>
                    {qrCanvasUrl && (
                      <img
                        src={qrCanvasUrl}
                        alt="QR Code de session"
                        className="w-56 h-56 rounded-xl mx-auto shadow-inner"
                      />
                    )}
                    <div className="mt-2 text-[11px] text-slate-500 font-mono">
                      Code de sécurité : <span className="font-bold text-slate-800 tracking-widest">{challengeCode}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-4 text-sm text-slate-600 max-w-sm mx-auto">
                <p className="font-semibold text-slate-800">Scannez ce QR code avec votre smartphone</p>
                <p className="text-xs text-slate-500 mt-1">
                  Ouvre instantanément la session d’assurance sur votre mobile sans aucun compte préalable.
                </p>
              </div>

              {/* Recovery controls */}
              <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => initSession(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Régénérer session</span>
                </button>
              </div>
            </div>
          ) : (
            /* USB WebADB Flow */
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 leading-relaxed">
                  <p className="font-semibold text-slate-800">Mode connexion USB Android sécurisée (WebADB)</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    <li>Déverrouillez Android et activez <strong>Options développeur → Débogage USB</strong>.</li>
                    <li>Utilisez un câble de données et sélectionnez <strong>Transfert de fichiers</strong>.</li>
                    <li>Cliquez ci-dessous, choisissez le téléphone, puis acceptez l’autorisation affichée sur son écran.</li>
                  </ol>
                </div>
              </div>

              {usbStatus === 'idle' && (
                <button
                  onClick={handleUsbAdbConnect}
                  className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all"
                >
                  <Usb className="w-4 h-4" />
                  <span>Détecter via USB</span>
                </button>
              )}

              {usbStatus === 'connecting' && (
                <div className="py-4 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
                  <span className="text-xs text-slate-600">Choisissez le téléphone puis confirmez l’autorisation ADB sur son écran…</span>
                </div>
              )}

              {usbStatus === 'diagnosing' && (
                <div className="py-4 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
                  <span className="text-xs text-slate-600">Diagnostic en cours : modèle, mémoire, stockage, batterie, écran, IMEI… Gardez le câble branché.</span>
                </div>
              )}

              {usbStatus === 'detected' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center text-emerald-800">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                  <p className="text-xs font-bold">Appareil USB détecté</p>
                  <p className="text-[11px] text-emerald-600">Les descripteurs USB ne confirment pas l’IMEI.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

