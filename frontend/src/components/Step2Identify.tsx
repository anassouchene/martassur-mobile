'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Cpu, CheckCircle, AlertTriangle, ArrowRight, ArrowLeft, ScanLine, HardDrive, Battery, RefreshCw, MemoryStick, Pencil } from 'lucide-react';
import Tesseract from 'tesseract.js';
import { DeviceDiagnosticCard } from '@/components/DeviceDiagnosticCard';
import { FunctionalTestsCard } from '@/components/FunctionalTestsCard';
import { FunctionalTestReport } from '@/lib/functionalTests';
import { DeviceDiagnostic, formatCapacity, isValidImei } from '@/lib/deviceDiagnostic';

interface Step2IdentifyProps {
  initialData?: any;
  detectedDevice?: any;
  sessionToken?: string;
  challengeCode?: string;
  onBack: () => void;
  onComplete: (deviceData: any) => void;
}

interface ScanResult {
  documentType: string;
  sourceLabel: string;
  imeis: string[];
  brand?: string | null;
  marketName?: string | null;
  modelCode?: string | null;
  storageGb?: number | null;
  ramGb?: number | null;
}

/** Valeur remplie automatiquement, avec sa provenance (affichée au client et transmise au dossier). */
interface AutoValue { value: string; source: string }

const gb = (option: string) => {
  const number = parseFloat(option.replace(',', '.'));
  return /to/i.test(option) ? number * 1024 : number;
};

export const Step2Identify: React.FC<Step2IdentifyProps> = ({ initialData, detectedDevice, sessionToken, challengeCode, onBack, onComplete }) => {
  // IMEI lu sur l'appareil via USB quand Android l'autorise : prérempli, toujours modifiable.
  const [imei, setImei] = useState<string>(initialData?.imei || detectedDevice?.usbImei || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [resolvedDevice, setResolvedDevice] = useState<any>(null);
  const [manualBrand, setManualBrand] = useState<string>('');
  const [manualModel, setManualModel] = useState<string>('');
  const [selectedStorage, setSelectedStorage] = useState<string>(initialData?.storage || '');
  const [selectedRam, setSelectedRam] = useState<string>(initialData?.ram || '');
  const [editStorage, setEditStorage] = useState<boolean>(false);
  const [editRam, setEditRam] = useState<boolean>(false);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const resolveSeqRef = useRef<number>(0);

  // Le navigateur ne donne qu'un code modèle (SM-S911U) : le catalogue TAC fournit marque et nom commercial.
  const [catalogName, setCatalogName] = useState<{ brand: string; marketName: string } | null>(null);
  const rawDiagnostic: DeviceDiagnostic | null = detectedDevice?.diagnostic || null;
  const diagnostic: DeviceDiagnostic | null = rawDiagnostic && catalogName
    ? { ...rawDiagnostic, brand: rawDiagnostic.brand || catalogName.brand, marketName: rawDiagnostic.marketName || catalogName.marketName }
    : rawDiagnostic;
  const isUsb = Boolean(detectedDevice?.verifiedViaUsb);

  // USB : QR qui ouvre directement les tests sur le téléphone branché (sans nouvel appairage).
  const [testsQr, setTestsQr] = useState<string>('');
  useEffect(() => {
    if (!isUsb || !sessionToken || !challengeCode) return;
    import('qrcode').then((QRCode) => QRCode.toDataURL(`${window.location.origin}/verify?session=${sessionToken}&code=${challengeCode}&tests=1`, { width: 256, margin: 1 }))
      .then(setTestsQr)
      .catch(() => setTestsQr(''));
  }, [isUsb, sessionToken, challengeCode]);

  // Diagnostic de fonctionnement lancé sur le téléphone : résultats récupérés dès qu'ils arrivent (QR ou USB).
  const [functionalTests, setFunctionalTests] = useState<FunctionalTestReport | null>(detectedDevice?.functionalTests || null);
  useEffect(() => {
    if (!sessionToken || !rawDiagnostic) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/insurance-sessions/${sessionToken}`, { cache: 'no-store' });
        const state = response.ok ? await response.json() : null;
        if (!stopped && state?.pairedDeviceInfo?.functionalTests) setFunctionalTests(state.pairedDeviceInfo.functionalTests);
      } catch { /* nouvel essai au prochain tour */ }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 15 * 60 * 1000);
    return () => { stopped = true; window.clearInterval(timer); window.clearTimeout(stop); };
  }, [isUsb, sessionToken, rawDiagnostic]);

  // Stockage : mesure USB, sinon lecture du scan (boîte, facture…). Le navigateur ne peut pas le lire.
  const autoStorage: AutoValue | null = isUsb && detectedDevice?.storageGb
    ? { value: formatCapacity(detectedDevice.storageGb), source: 'mesuré via USB' }
    : scanResult?.storageGb ? { value: formatCapacity(scanResult.storageGb), source: scanResult.sourceLabel.toLowerCase() } : null;

  // RAM : USB, puis scan, puis navigateur (navigator.deviceMemory arrondi à la puissance de 2 inférieure, plafonné à 8).
  const webRam = (options: string[]): string | null => {
    const memory = rawDiagnostic?.source === 'WEB_BROWSER' ? rawDiagnostic.ramRawGb : null;
    if (!memory) return null;
    const candidates = options.filter((option) => memory >= 8 ? gb(option) >= 8 : gb(option) >= memory && gb(option) < memory * 2);
    return candidates.length === 1 ? candidates[0] : null;
  };
  const autoRam: AutoValue | null = isUsb && detectedDevice?.ramGb
    ? { value: `${detectedDevice.ramGb} Go`, source: 'mesurée via USB' }
    : scanResult?.ramGb ? { value: `${scanResult.ramGb} Go`, source: scanResult.sourceLabel.toLowerCase() }
    : resolvedDevice?.ramOptions && webRam(resolvedDevice.ramOptions) ? { value: webRam(resolvedDevice.ramOptions)!, source: 'détectée par le navigateur du téléphone' } : null;

  const storageOptions: string[] = resolvedDevice?.storageOptions || [];
  const ramOptions: string[] = resolvedDevice?.ramOptions || [];
  const storageAuto = autoStorage && storageOptions.includes(autoStorage.value) ? autoStorage
    : storageOptions.length === 1 ? { value: storageOptions[0], source: 'seule version de ce modèle' } : null;
  const ramAuto = autoRam && ramOptions.includes(autoRam.value) ? autoRam
    : ramOptions.length === 1 ? { value: ramOptions[0], source: 'seule version de ce modèle' } : null;

  useEffect(() => {
    const code = rawDiagnostic?.model;
    if (!code || (rawDiagnostic?.brand && rawDiagnostic?.marketName)) return;
    fetch(`/api/devices/model-lookup?code=${encodeURIComponent(code)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setCatalogName(data))
      .catch(() => undefined);
  }, [rawDiagnostic?.model, rawDiagnostic?.brand, rawDiagnostic?.marketName]);

  // Résout dès que 15 chiffres sont présents, y compris après reprise de brouillon,
  // retour arrière, autoremplissage navigateur, préremplissage USB ou scan.
  useEffect(() => {
    if (imei.length === 15) resolveImei(imei);
    else setResolvedDevice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imei]);

  // Valeurs détectées automatiquement : appliquées dès qu'elles existent, sans liste à parcourir.
  useEffect(() => { if (storageAuto && !editStorage) setSelectedStorage(storageAuto.value); }, [storageAuto?.value, editStorage]);
  useEffect(() => { if (ramAuto && !editRam) setSelectedRam(ramAuto.value); }, [ramAuto?.value, editRam]);

  // Marque / modèle si le TAC est inconnu : repris de l'appareil détecté (USB, QR) ou du scan.
  useEffect(() => {
    const brand = detectedDevice?.brand || diagnostic?.brand || scanResult?.brand;
    const model = diagnostic?.marketName || scanResult?.marketName || detectedDevice?.model || diagnostic?.model;
    if (brand && !manualBrand) setManualBrand(brand);
    if (model && !manualModel) setManualModel(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedDevice?.brand, detectedDevice?.model, diagnostic?.brand, diagnostic?.marketName, scanResult]);

  const handleImeiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImei(e.target.value.replace(/\D/g, '').slice(0, 15));
    setErrorMsg('');
  };

  const resolveImei = async (imeiToResolve: string) => {
    const seq = ++resolveSeqRef.current;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/devices/imei/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei: imeiToResolve, sessionToken }),
      });
      const data = await res.json();
      if (seq !== resolveSeqRef.current) return; // réponse d'une saisie précédente
      if (!data.valid) {
        setErrorMsg(data.message || 'Numéro IMEI invalide (échec de la clé Luhn).');
        setResolvedDevice(null);
        return;
      }
      setResolvedDevice(data);
      // Sans détection : choix du brouillon, sinon première variante, à confirmer par le client.
      const keep = (options: string[] | undefined, previous: string) =>
        !options?.length ? '' : options.includes(previous) ? previous : options[0];
      setSelectedStorage((previous) => keep(data.storageOptions, previous || initialData?.storage));
      setSelectedRam((previous) => keep(data.ramOptions, previous || initialData?.ram));
    } catch (err) {
      console.error(err);
      if (seq === resolveSeqRef.current) setErrorMsg('Erreur lors de la résolution de l’IMEI.');
    } finally {
      if (seq === resolveSeqRef.current) setLoading(false);
    }
  };

  /** Secours hors ligne : OCR navigateur (IMEI seulement) si la lecture automatique est indisponible. */
  const tesseractFallback = async (file: File) => {
    const result = await Tesseract.recognize(file, 'eng');
    const candidates = (result.data.text.match(/(?:\d[\s.\-:]*){15}/g) || []).map((c) => c.replace(/\D/g, ''));
    return candidates.find((candidate) => candidate.length === 15 && isValidImei(candidate)) || null;
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanning(true);
    setErrorMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionToken', sessionToken || '');
      const response = await fetch('/api/devices/scan', { method: 'POST', body: formData });
      const data = await response.json().catch(() => ({}));
      if (response.status === 503) {
        const found = await tesseractFallback(file);
        if (found) setImei(found);
        else setErrorMsg('Lecture automatique indisponible et aucun IMEI lisible : saisissez-le ou réessayez dans un instant.');
        return;
      }
      if (!response.ok) {
        setErrorMsg(data.message || 'La photo n’a pas pu être lue. Réessayez.');
        return;
      }
      setScanResult(data);
      setEditStorage(false);
      setEditRam(false);
      if (data.imeis?.length) setImei(data.imeis[0]);
      else setErrorMsg(`${data.message || 'Aucun IMEI lisible sur cette photo.'} Photographiez l’étiquette de la boîte ou l’écran *#06# en entier, bien éclairé.`);
    } catch (err) {
      console.error(err);
      setErrorMsg('La photo n’a pas pu être envoyée. Vérifiez votre connexion et réessayez.');
    } finally {
      setScanning(false);
    }
  };

  const handleNext = () => {
    if (!resolvedDevice) return;
    onComplete({
      imei: imei,
      maskedImei: resolvedDevice.maskedImei,
      tac: resolvedDevice.tac,
      brand: resolvedDevice.requiresManualReview ? manualBrand.trim() : resolvedDevice.brand,
      // Nom commercial plutôt que la fiche TAC brute (« XIAOMI NOTE 12 PRO 4G, Xiaomi 2209116AG, Global Model, 2022 »).
      model: resolvedDevice.requiresManualReview ? manualModel.trim() : (resolvedDevice.marketName || resolvedDevice.model),
      marketName: resolvedDevice.marketName,
      storage: selectedStorage,
      ram: selectedRam,
      storageSource: storageAuto && selectedStorage === storageAuto.value ? storageAuto.source : 'déclaré par le client',
      ramSource: ramAuto && selectedRam === ramAuto.value ? ramAuto.source : 'déclarée par le client',
      batteryMah: resolvedDevice.batteryMah,
      sourceBadges: resolvedDevice.sourceBadges,
      usbImeiStatus: resolvedDevice.usbImeiStatus,
      deviceCoherence: resolvedDevice.deviceCoherence,
    });
  };

  const detectedLabel = [diagnostic?.marketName || [diagnostic?.brand, diagnostic?.model].filter(Boolean).join(' '), diagnostic?.marketName && diagnostic?.model ? `(${diagnostic.model})` : '']
    .filter(Boolean).join(' ') || 'appareil détecté';
  const hasMismatch = Boolean(resolvedDevice && (resolvedDevice.usbImeiStatus === 'MISMATCH' || resolvedDevice.deviceCoherence === 'MISMATCH'));
  const canContinue = Boolean(resolvedDevice
    && (!resolvedDevice.requiresManualReview || (manualBrand.trim() && manualModel.trim()))
    && (!storageOptions.length || selectedStorage)
    && (!ramOptions.length || selectedRam));

  /** Valeur détectée : une ligne lisible, pas de liste (bouton « modifier » si le client sait mieux). */
  const AutoRow = ({ icon, label, auto, onEdit }: { icon: React.ReactNode; label: string; auto: AutoValue; onEdit: () => void }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-xs">
      <span className="flex items-center gap-1.5 text-slate-600">{icon}{label}</span>
      <span className="flex items-center gap-2 text-right">
        <span><strong className="text-sm text-slate-900">{auto.value}</strong><span className="block text-[10px] text-emerald-700">{auto.source}</span></span>
        <button type="button" onClick={onEdit} aria-label={`Modifier ${label}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
      </span>
    </div>
  );

  const ChoiceList = ({ label, options, selected, onSelect, color }: { label: string; options: string[]; selected: string; onSelect: (value: string) => void; color: string }) => (
    <div>
      <p className="mb-2 text-xs font-bold text-slate-800">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option} type="button" onClick={() => onSelect(option)}
            className={`rounded-xl border px-4 py-2 text-xs font-bold transition-all ${selected === option ? `${color} text-white shadow-sm` : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'}`}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 mb-3">
          <Cpu className="w-3.5 h-3.5" /> Étape 2 : Identification technique
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Identifier mon appareil</h1>
        <p className="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed">
          Un scan suffit : IMEI, modèle, stockage et mémoire sont remplis automatiquement.
        </p>
      </div>

      {!functionalTests && isUsb && challengeCode && testsQr && (
        <div className="mb-5 flex flex-col items-center gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:flex-row">
          <img src={testsQr} alt="QR code des tests de fonctionnement" className="h-32 w-32 rounded-xl bg-white p-1.5" />
          <div className="text-xs text-blue-900">
            <p className="text-sm font-bold">Tester que tout fonctionne</p>
            <p className="mt-1">Scannez ce QR code avec le téléphone branché puis touchez <strong>« Lancer le diagnostic »</strong> : caméras, micro, haut-parleur, capteurs et écran tactile. Les résultats s’ajoutent au diagnostic USB.</p>
            <p className="mt-2 flex items-center gap-1.5 text-blue-700"><RefreshCw className="h-3.5 w-3.5 animate-spin" />En attente des résultats…</p>
          </div>
        </div>
      )}
      {functionalTests ? <FunctionalTestsCard report={functionalTests} collapsible /> : rawDiagnostic?.source === 'WEB_BROWSER' && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>Sur le téléphone, touchez <strong>« Lancer le diagnostic »</strong> : caméras, micro, haut-parleur, capteurs et écran tactile sont testés, les résultats s’afficheront ici.</span>
        </div>
      )}
      {diagnostic ? (
        <DeviceDiagnosticCard diagnostic={diagnostic} maskedImeis={detectedDevice?.usbImeisMasked} collapsible />
      ) : detectedDevice?.verifiedViaUsb && (
        // Brouillon antérieur au diagnostic complet : données USB minimales.
        <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">
          <strong>Détecté via WebADB :</strong> {detectedDevice.brand} {detectedDevice.model}
          {detectedDevice.androidVersion && <span> · Android {detectedDevice.androidVersion}</span>}
          <p className="mt-1 text-xs text-indigo-700">Reconnectez le téléphone en USB (étape 1) pour un diagnostic complet.</p>
        </div>
      )}

      <input ref={scanInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScan} />

      {/* Scan automatique */}
      <div className="mb-5 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50/60 p-4">
        {scanning ? (
          <div className="flex items-center gap-3 py-2 text-sm text-blue-800">
            <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
            <span><strong>Lecture automatique en cours…</strong><span className="block text-xs text-blue-700">IMEI, modèle, stockage et mémoire (environ 10 secondes).</span></span>
          </div>
        ) : (
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="text-xs text-slate-700">
              <p className="text-sm font-bold text-slate-900">{scanResult ? 'Scanner une autre photo' : 'Scannez la boîte ou l’écran *#06#'}</p>
              <p>Étiquette de la boîte, écran <strong className="font-mono">*#06#</strong>, facture ou « À propos du téléphone ».</p>
            </div>
            <button type="button" onClick={() => scanInputRef.current?.click()} disabled={!sessionToken}
              className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 disabled:opacity-50 sm:w-auto">
              <ScanLine className="h-5 w-5" />Scanner
            </button>
          </div>
        )}
        {scanResult && !scanning && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-xs text-slate-700">
            <p className="flex items-center gap-1.5 font-bold text-emerald-700"><CheckCircle className="h-4 w-4" />{scanResult.sourceLabel}</p>
            <p className="mt-1">
              {[scanResult.marketName && `${scanResult.brand ? `${scanResult.brand} ` : ''}${scanResult.marketName}`, scanResult.ramGb && `${scanResult.ramGb} Go RAM`, scanResult.storageGb && formatCapacity(scanResult.storageGb)].filter(Boolean).join(' · ') || 'Modèle non lisible'}
              {scanResult.imeis.length > 0 && <> · {scanResult.imeis.length === 2 ? 'IMEI 1 et 2 lus (IMEI 1 retenu)' : 'IMEI lu'}</>}
            </p>
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-500">La photo est lue par notre service d’analyse automatique puis supprimée immédiatement.</p>
      </div>

      {/* IMEI */}
      <div className="mb-6">
        <label className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-800">
          <span>Numéro IMEI (15 chiffres)</span><span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={imei}
            onChange={handleImeiChange}
            placeholder="Rempli par le scan, ou saisissez-le"
            maxLength={15}
            className={`w-full px-4 py-3.5 rounded-xl border text-base font-mono tracking-widest outline-none transition-all ${
              errorMsg
                ? 'border-red-400 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-400/20'
                : resolvedDevice
                ? 'border-emerald-500 bg-emerald-50/20 text-slate-900 focus:ring-2 focus:ring-emerald-500/20'
                : 'border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
            }`}
          />
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {loading || scanning ? <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              : resolvedDevice ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : null}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-slate-500">
          <span>{resolvedDevice?.sourceBadges?.imei || <>Composez <strong className="text-slate-700 font-mono">*#06#</strong> sur le téléphone pour l’afficher.</>}</span>
          <span>{imei.length}/15 chiffres</span>
        </div>
        {errorMsg && (
          <div className="mt-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /><span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Appareil identifié */}
      {resolvedDevice && (
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200 space-y-4 mb-8">
          <div className="flex items-start justify-between border-b border-slate-200/80 pb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">Appareil identifié</span>
              <h3 className="text-lg font-black text-slate-900 mt-1">
                {resolvedDevice.requiresManualReview ? `${manualBrand} ${manualModel}`.trim() || 'Modèle à préciser' : `${resolvedDevice.brand} ${resolvedDevice.marketName || resolvedDevice.model}`}
              </h3>
              <p className="text-xs text-slate-500">
                TAC : <strong className="font-mono text-slate-700">{resolvedDevice.tac}</strong> • IMEI masqué : <strong className="font-mono text-slate-700">{resolvedDevice.maskedImei}</strong>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
              <CheckCircle className="w-3.5 h-3.5" /> Luhn conforme
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
              <span className="text-slate-500">Marque & modèle :</span>
              <span className="font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{resolvedDevice.sourceBadges?.brand || 'via TAC'}</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
              <span className="text-slate-500">Batterie nominale :</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <Battery className="w-3.5 h-3.5 text-emerald-600" />{resolvedDevice.batteryMah ? `${resolvedDevice.batteryMah} mAh` : 'Non disponible'}
              </span>
            </div>
          </div>

          {(resolvedDevice.usbImeiStatus === 'MATCH' || resolvedDevice.deviceCoherence === 'MATCH') && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-800 space-y-0.5">
              {resolvedDevice.usbImeiStatus === 'MATCH' && <p className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> IMEI identique à celui lu sur le téléphone via USB.</p>}
              {resolvedDevice.deviceCoherence === 'MATCH' && <p className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Le téléphone {isUsb ? 'branché' : 'qui a scanné le QR code'} ({detectedLabel}) correspond à cet IMEI.</p>}
            </div>
          )}
          {hasMismatch && (
            <div role="alert" className="space-y-1.5 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              <p className="flex items-center gap-1.5 text-sm font-bold"><AlertTriangle className="h-4 w-4 shrink-0" />
                {resolvedDevice.usbImeiStatus === 'MISMATCH' ? 'Cet IMEI n’est pas celui du téléphone branché' : 'Cet IMEI n’appartient pas au téléphone détecté'}
              </p>
              {resolvedDevice.usbImeiStatus === 'MISMATCH' ? (
                <p>Le téléphone branché en USB a l’IMEI {detectedDevice?.usbImeisMasked?.join(' / ')}, différent de celui saisi.</p>
              ) : (
                <p>Le téléphone {isUsb ? 'branché en USB' : 'qui a scanné le QR code'} est un <strong>{detectedLabel}</strong>, mais cet IMEI correspond à un <strong>{resolvedDevice.brand} {resolvedDevice.marketName || resolvedDevice.model}</strong>.</p>
              )}
              <p className="text-slate-800"><strong>À faire :</strong> scannez la boîte ou l’écran <strong className="font-mono">*#06#</strong> du téléphone à assurer. Si vous continuez ainsi, le dossier est transmis automatiquement à un gestionnaire pour vérification.</p>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200/80 space-y-3">
            {resolvedDevice.requiresManualReview && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">Marque *</label>
                  <input value={manualBrand} onChange={(event) => setManualBrand(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">Modèle *</label>
                  <input value={manualModel} onChange={(event) => setManualModel(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <p className="sm:col-span-2 text-[11px] text-amber-800">Modèle absent du catalogue : {manualBrand && manualModel ? 'rempli à partir du téléphone détecté, ' : ''}vérifié par un gestionnaire.</p>
              </div>
            )}

            {storageOptions.length > 0 && (storageAuto && !editStorage
              ? <AutoRow icon={<HardDrive className="h-3.5 w-3.5" />} label="Stockage" auto={storageAuto} onEdit={() => setEditStorage(true)} />
              : <ChoiceList label={autoStorage && !storageOptions.includes(autoStorage.value)
                  ? `Stockage (${autoStorage.value} ${autoStorage.source}, absent du catalogue — choisissez) :`
                  : 'Stockage — seule information illisible automatiquement, choisissez :'}
                  options={storageOptions} selected={selectedStorage} onSelect={setSelectedStorage} color="border-blue-600 bg-blue-600" />)}

            {ramOptions.length > 0 && (ramAuto && !editRam
              ? <AutoRow icon={<MemoryStick className="h-3.5 w-3.5" />} label="Mémoire vive" auto={ramAuto} onEdit={() => setEditRam(true)} />
              : <ChoiceList label="Mémoire vive (RAM) :" options={ramOptions} selected={selectedRam} onSelect={setSelectedRam} color="border-indigo-600 bg-indigo-600" />)}

            {!storageAuto && storageOptions.length > 1 && (
              <p className="text-[11px] text-slate-500">Astuce : scannez la boîte (mention « 8GB+256GB ») pour que le stockage soit rempli automatiquement.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <button type="button" onClick={onBack}
          className="px-5 py-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-4 h-4" /><span>Retour</span>
        </button>
        <button type="button" disabled={!canContinue} onClick={handleNext}
          className={`px-7 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md transition-all ${
            canContinue
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/25 active:scale-95'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}>
          <span>Continuer vers les photos</span><ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
