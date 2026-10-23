'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Smartphone, CheckCircle2, RefreshCw, MonitorSmartphone } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { DeviceDiagnosticCard } from '@/components/DeviceDiagnosticCard';
import { PhoneDiagnosticRunner } from '@/components/PhoneDiagnosticRunner';
import { collectWebDiagnostic, DeviceDiagnostic } from '@/lib/deviceDiagnostic';

// Robots qui exécutent les pages (lecture vocale Google, aperçus de liens…) : même liste que le serveur.
const BOT_UA = /[a-z]bot\/|\(compatible;[^)]*\+?https?:\/\/|crawl|spider|slurp|Google-Read-Aloud|Googlebot|Google-InspectionTool|HeadlessChrome|PhantomJS|facebookexternalhit|WhatsApp|TelegramBot|Slackbot|Discordbot|Lighthouse|Bingbot|BingPreview|SkypeUriPreview|Applebot|YandexBot|Baiduspider/i;

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionToken = searchParams.get('session');
  const code = searchParams.get('code');
  // Lien « tests » (mode USB, étape 2) : téléphone déjà identifié, on lance directement le diagnostic.
  const testsOnly = searchParams.get('tests') === '1';

  const [loading, setLoading] = useState<boolean>(true);
  const [success, setSuccess] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [diagnostic, setDiagnostic] = useState<DeviceDiagnostic | null>(null);
  // Mode « Version pour ordinateur » : on attend que le client le désactive (Chrome recharge alors la page)
  // au lieu d'associer un téléphone dont le modèle est masqué.
  const [desktopModeBlocked, setDesktopModeBlocked] = useState<boolean>(false);
  // Navigateur automatisé ou sans vraie puce graphique (rendu logiciel) : association seulement après un toucher.
  const [needsTap, setNeedsTap] = useState<boolean>(false);
  const [isBot, setIsBot] = useState<boolean>(false);

  useEffect(() => {
    if (sessionToken && testsOnly) {
      setIsBot(BOT_UA.test(navigator.userAgent));
      setSuccess(true);
      setLoading(false);
    } else if (sessionToken) {
      pairDevice(sessionToken);
    } else {
      setLoading(false);
      setErrorMsg('Jeton de session manquant dans le lien.');
    }
  }, [sessionToken]);

  const pairDevice = async (token: string, acceptDesktopMode = false, userConfirmed = false) => {
    setLoading(true);
    setDesktopModeBlocked(false);
    setNeedsTap(false);
    try {
      if (BOT_UA.test(navigator.userAgent)) {
        setIsBot(true);
        return;
      }
      const webDiagnostic = await collectWebDiagnostic();
      setDiagnostic(webDiagnostic);
      const automated = (navigator as any).webdriver === true || /SwiftShader|llvmpipe|softpipe|Software Rasterizer/i.test(webDiagnostic.gpu || '');
      if (automated && !userConfirmed) {
        setNeedsTap(true);
        return;
      }
      if (webDiagnostic.desktopMode && !acceptDesktopMode) {
        setDesktopModeBlocked(true);
        return;
      }
      const res = await fetch(`/api/insurance-sessions/${token}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceModel: webDiagnostic.model || navigator.userAgent,
          os: navigator.platform,
          browser: navigator.userAgent,
          screenResolution: webDiagnostic.screenResolution,
          batteryLevel: webDiagnostic.battery?.level ?? null,
          diagnostic: webDiagnostic,
          challengeCode: code,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Échec de l’appairage.');
      }

      setSuccess(true);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Impossible d’associer le smartphone.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm text-center">
      {isBot && !loading ? (
        <div className="space-y-2 py-8 text-center">
          <Smartphone className="mx-auto h-10 w-10 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700">Ouvrez ce lien en scannant le QR code avec votre téléphone.</p>
        </div>
      ) : needsTap && !loading ? (
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-700"><Smartphone className="h-8 w-8" /></div>
          <h1 className="text-xl font-black text-slate-900">Associer ce téléphone</h1>
          <p className="text-sm text-slate-600">Touchez le bouton pour relier ce téléphone à votre demande d’assurance.</p>
          <button onClick={() => sessionToken && pairDevice(sessionToken, true, true)} className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white">Associer ce téléphone</button>
        </div>
      ) : desktopModeBlocked && !loading ? (
        <div className="space-y-4 text-left">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><MonitorSmartphone className="h-8 w-8" /></div>
          <h1 className="text-center text-xl font-black text-slate-900">Désactivez le mode ordinateur</h1>
          <p className="text-center text-sm text-slate-600">Votre navigateur affiche la « Version pour ordinateur » : il cache le modèle de votre téléphone, nécessaire à la vérification automatique.</p>
          <ol className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
            <li><strong>1.</strong> Touchez le menu <strong>⋮</strong> en haut à droite.</li>
            <li><strong>2.</strong> Décochez <strong>« Version pour ordinateur »</strong>.</li>
            <li><strong>3.</strong> La page se recharge et la vérification reprend toute seule.</li>
          </ol>
          <button onClick={() => window.location.reload()} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white">C’est fait, réessayer</button>
          <button onClick={() => sessionToken && pairDevice(sessionToken, true)} className="w-full text-xs font-semibold text-slate-500 underline">Continuer sans le modèle (vérification manuelle)</button>
        </div>
      ) : loading ? (
        <div className="py-12 space-y-3">
          <RefreshCw className="w-10 h-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-700">Connexion sécurisée en cours...</p>
          <p className="text-xs text-slate-500">Validation de la clé de session et du certificat</p>
        </div>
      ) : success ? (
        <div className="space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              Appairage Réussi
            </span>
            <h1 className="text-2xl font-black text-slate-900 mt-2">
              Interaction confirmée
            </h1>
            <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto">
              Téléphone associé à votre demande. Dernière étape sur ce téléphone : le diagnostic de fonctionnement.
            </p>
          </div>

          {code && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              Code de sécurité validé : <strong className="font-mono text-blue-700 font-bold">{code}</strong>
            </div>
          )}

          {diagnostic && <div className="text-left"><DeviceDiagnosticCard diagnostic={diagnostic} /></div>}

          {sessionToken && code && <PhoneDiagnosticRunner sessionToken={sessionToken} challengeCode={code} />}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <Smartphone className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Erreur d'appairage</h2>
          <p className="text-xs text-red-600">{errorMsg}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
          >
            Retourner à l'accueil
          </button>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-12 flex flex-col justify-center">
        <Suspense fallback={
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm">Initialisation de la session...</p>
          </div>
        }>
          <VerifyContent />
        </Suspense>
      </main>
    </>
  );
}

