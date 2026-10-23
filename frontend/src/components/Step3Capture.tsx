'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, RefreshCw, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { conditionDefects, DeviceCondition } from '@/lib/deviceCondition';

type Slot = 'front' | 'back';

/** Refus d'une photo, expliqué au client avec l'action à faire. */
interface PhotoError {
  code: string;
  title: string;
  message: string;
  hint: string;
  previewUrl?: string;
  canConfirm?: boolean;   // marque/modèle différent : le client peut affirmer que c'est son téléphone
  suggestFixDevice?: boolean;
}

const SIDE_LABEL: Record<Slot, string> = { front: 'recto (écran)', back: 'verso (dos)' };

const describeRejection = (code: string, slot: Slot, expected: string, failure: any): Omit<PhotoError, 'previewUrl'> => {
  const other: Slot = slot === 'front' ? 'back' : 'front';
  // « Redmi » + « Redmi Note 11 Pro » → « Redmi Note 11 Pro » (pas de marque en double).
  const brand: string = failure.observedBrand || '';
  const model: string = failure.observedModel || '';
  const brandWords = brand.toLowerCase().split(/[\s/]+/).filter((word) => word.length > 2);
  const observed = model && brandWords.some((word) => model.toLowerCase().includes(word)) ? model : [brand, model].filter(Boolean).join(' ');
  // Le numéro lu est déjà cité dans la phrase : on ne le répète pas entre parenthèses.
  const observedName = failure.modelCodeRead ? observed.replace(` (${failure.modelCodeRead})`, '') : observed;
  switch (code) {
    case 'DUPLICATE_IMAGE':
      return { code, title: 'Photo déjà utilisée', message: 'Cette photo a déjà été envoyée dans une autre demande d’assurance. Chaque photo doit être prise spécialement pour ce dossier.', hint: `Prenez maintenant une nouvelle photo du ${SIDE_LABEL[slot]} de votre ${expected}.` };
    case 'DUPLICATE_OTHER_SIDE':
      return { code, title: `Même photo que pour le ${SIDE_LABEL[other]}`, message: `Vous avez déjà envoyé cette image pour le ${SIDE_LABEL[other]}. Il faut deux photos différentes : l’écran ET le dos du téléphone.`, hint: `Photographiez le ${SIDE_LABEL[slot]} du téléphone.` };
    case 'DUPLICATE_SAME_SLOT':
      return { code, title: 'Photo déjà envoyée', message: 'Cette image a déjà été envoyée pour ce côté.', hint: 'Prenez une nouvelle photo.' };
    case 'NOT_A_PHONE':
      return { code, title: 'Aucun téléphone reconnu', message: failure.message || 'La photo ne montre pas clairement un smartphone.', hint: 'Posez le téléphone sur une surface unie, bien éclairée, et cadrez-le en entier.' };
    case 'SCREENSHOT':
      return { code, title: 'Capture d’écran refusée', message: 'Une capture d’écran, ou la photo d’une image affichée sur un autre écran, n’est pas acceptée.', hint: 'Photographiez le téléphone lui-même avec un autre appareil.' };
    case 'MULTIPLE_PHONES':
      return { code, title: 'Plusieurs téléphones visibles', message: 'La photo doit montrer un seul téléphone : celui à assurer.', hint: 'Retirez les autres appareils du cadre et reprenez la photo.' };
    case 'SCREEN_OFF':
      return { code, title: 'Écran éteint', message: 'L’écran doit être allumé pour vérifier que l’affichage fonctionne (pas de pixels morts, lignes ou taches).', hint: 'Allumez l’écran, réglez la luminosité au maximum et reprenez la photo de face.' };
    case 'WRONG_SIDE':
      return slot === 'front'
        ? { code, title: 'Mauvais côté : on attend l’écran', message: 'Cette photo montre le dos du téléphone. Pour le recto, il faut voir l’écran allumé.', hint: 'Allumez l’écran et photographiez la face avant.' }
        : { code, title: 'Mauvais côté : on attend le dos', message: 'Cette photo montre l’écran. Pour le verso, il faut voir le dos et le bloc photo.', hint: 'Retournez le téléphone, retirez la coque et photographiez le dos.' };
    case 'BRAND_MISMATCH':
      return { code, title: `Ce téléphone n’est pas un ${expected}`, message: failure.modelCodeRead
        ? `Le numéro de modèle imprimé sur ce téléphone (${failure.modelCodeRead}) est celui d’un ${observedName || 'autre appareil'}, alors que l’IMEI saisi correspond à un ${expected}.`
        : `La photo semble montrer ${observed ? `un ${observed}` : 'un téléphone d’une autre marque'}, alors que l’IMEI saisi correspond à un ${expected}.`, hint: 'Photographiez le téléphone dont vous avez saisi l’IMEI, ou corrigez l’IMEI à l’étape 2.', canConfirm: true, suggestFixDevice: true };
    case 'MODEL_MISMATCH':
      return { code, title: 'Le modèle ne correspond pas', message: failure.modelCodeRead
        ? `Le numéro de modèle imprimé sur ce téléphone (${failure.modelCodeRead}) est celui d’un ${observedName || 'autre modèle'}, alors que l’IMEI saisi correspond à un ${expected}.`
        : `La photo semble montrer ${observed ? `un ${observed}` : 'un autre modèle'}, alors que l’IMEI saisi correspond à un ${expected}.`, hint: 'Vérifiez que vous photographiez le bon téléphone (composez *#06# pour comparer l’IMEI), ou corrigez l’IMEI à l’étape 2.', canConfirm: true, suggestFixDevice: true };
    case 'ANALYSIS_UNAVAILABLE':
      return { code, title: 'Vérification momentanément indisponible', message: 'Le contrôle automatique de la photo n’a pas répondu.', hint: 'Réessayez dans quelques instants.' };
    case 'SESSION_INVALID':
      return { code, title: 'Session expirée', message: 'Votre session de vérification n’est plus valide.', hint: 'Revenez à l’étape 1 pour démarrer une nouvelle session.' };
    default:
      return { code, title: 'Photo refusée', message: failure.message || 'Le téléversement a échoué.', hint: 'Reprenez la photo.' };
  }
};

class PhotoRejection extends Error {
  constructor(public detail: Omit<PhotoError, 'previewUrl'>) { super(detail.message); }
}

interface Step3CaptureProps {
  sessionToken?: string;
  deviceData?: any;
  onBack: () => void;
  onComplete: (evidenceData: any) => void;
}

export const Step3Capture: React.FC<Step3CaptureProps> = ({ sessionToken, deviceData, onBack, onComplete }) => {
  const [challengeCode] = useState<string>(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [activeSlot, setActiveSlot] = useState<'front' | 'back' | null>(null);

  // Photos state
  const [frontPhoto, setFrontPhoto] = useState<{ id?: string; previewUrl: string; sha256?: string; quality: number; condition?: DeviceCondition | null; modelCheck?: string; modelCodeRead?: string | null } | null>(null);
  const [backPhoto, setBackPhoto] = useState<{ id?: string; previewUrl: string; sha256?: string; quality: number; condition?: DeviceCondition | null; modelCheck?: string; modelCodeRead?: string | null } | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [slotErrors, setSlotErrors] = useState<Record<Slot, PhotoError | null>>({ front: null, back: null });
  // Dernière photo refusée par slot, pour la renvoyer si le client confirme que c'est bien son téléphone.
  const rejectedFilesRef = useRef<Record<Slot, Blob | null>>({ front: null, back: null });
  const expectedDevice = [deviceData?.brand, deviceData?.marketName || deviceData?.model].filter(Boolean).join(' ') || 'téléphone';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async (slot: 'front' | 'back') => {
    setActiveSlot(slot);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: slot === 'front' ? 'user' : 'environment', width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      console.warn('Camera access error, fallback to file upload:', err);
      // Fallback to trigger file input
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const captureCameraPhoto = async () => {
    if (!videoRef.current || !activeSlot) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    stopCamera();

    // Convert dataUrl to Blob and compress before upload
    canvas.toBlob(async (blob) => {
      if (blob) {
        await processAndUpload(blob, activeSlot, dataUrl);
      }
    }, 'image/jpeg', 0.9);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSlot) return;

    const previewUrl = URL.createObjectURL(file);
    await processAndUpload(file, activeSlot, previewUrl);
  };

  const analyzeImage = async (blob: Blob) => {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(160, width);
    canvas.height = Math.max(1, Math.round(height * canvas.width / width));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Analyse de l’image indisponible.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Float32Array(canvas.width * canvas.height);
    let brightness = 0;
    for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
      gray[pixel] = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      brightness += gray[pixel];
    }
    brightness /= gray.length;
    let sum = 0, squared = 0, samples = 0;
    for (let y = 1; y < canvas.height - 1; y += 1) for (let x = 1; x < canvas.width - 1; x += 1) {
      const index = y * canvas.width + x;
      const value = 4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - canvas.width] - gray[index + canvas.width];
      sum += value; squared += value * value; samples += 1;
    }
    const mean = samples ? sum / samples : 0;
    return {
      width,
      height,
      brightness: Math.round(brightness),
      sharpness: Math.round(samples ? squared / samples - mean * mean : 0),
    };
  };

  const processAndUpload = async (fileOrBlob: File | Blob, slot: Slot, previewUrl: string, confirmDeviceMismatch = false) => {
    setIsUploading(true);
    setErrorMsg('');
    setSlotErrors((current) => ({ ...current, [slot]: null }));
    setAnalysisStatus('Analyse de la qualité…');
    const reject = (detail: Omit<PhotoError, 'previewUrl'>): never => { throw new PhotoRejection(detail); };
    let shownUrl = previewUrl; // l'URL d'origine est libérée après compression
    try {
      const analysis = await analyzeImage(fileOrBlob);
      if (analysis.width < 640 || analysis.height < 480) reject({ code: 'LOW_RESOLUTION', title: 'Photo trop petite', message: `Résolution ${analysis.width} × ${analysis.height} px : il faut au moins 640 × 480 px.`, hint: 'Utilisez l’appareil photo plutôt qu’une image envoyée par messagerie.' });
      if (analysis.brightness < 35) reject({ code: 'TOO_DARK', title: 'Photo trop sombre', message: 'Le téléphone n’est pas assez visible.', hint: 'Rapprochez-vous d’une fenêtre ou allumez la lumière, puis reprenez la photo.' });
      if (analysis.sharpness < 18) reject({ code: 'BLURRY', title: 'Photo floue', message: 'Les détails du téléphone ne sont pas nets.', hint: 'Posez le téléphone, tenez l’appareil immobile et touchez l’écran pour faire la mise au point.' });
      setAnalysisStatus(`Vérification que la photo montre bien votre ${expectedDevice} (environ 15 secondes)…`);

      const original = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], `${slot}_photo.jpg`, { type: fileOrBlob.type || 'image/jpeg' });
      const previewFile = await imageCompression(original, { maxSizeMB: 0.35, maxWidthOrHeight: 1200, useWebWorker: true });
      const optimizedPreviewUrl = URL.createObjectURL(previewFile);
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
      shownUrl = optimizedPreviewUrl;
      const formData = new FormData();
      formData.append('file', original, `${slot}_photo.jpg`);
      formData.append('evidenceType', slot === 'front' ? 'PHOTO_FRONT' : 'PHOTO_BACK');
      formData.append('analysisJson', JSON.stringify(analysis));
      formData.append('externalAiConsent', 'true');
      formData.append('expectedBrand', deviceData?.brand || '');
      formData.append('expectedModel', deviceData?.marketName || deviceData?.model || '');
      formData.append('expectedTac', deviceData?.tac || '');
      formData.append('confirmDeviceMismatch', confirmDeviceMismatch ? 'true' : 'false');
      if (sessionToken) {
        formData.append('sessionToken', sessionToken);
      }

      const res = await fetch('/api/evidence/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        if (failure.code && failure.canConfirm) rejectedFilesRef.current[slot] = original;
        reject(describeRejection(failure.code || (res.status === 409 ? 'DUPLICATE_IMAGE' : 'UNKNOWN'), slot, expectedDevice, failure));
      }
      const data = await res.json();
      if (data.qualityScore < 60) reject({ code: 'LOW_QUALITY', title: 'Qualité insuffisante', message: 'La photo n’est pas assez exploitable pour le contrôle.', hint: 'Reprenez la photo avec plus de lumière et sans reflet.' });
      rejectedFilesRef.current[slot] = null;

      const photoResult = {
        id: data.evidenceId,
        previewUrl: optimizedPreviewUrl,
        sha256: data.sha256,
        quality: data.qualityScore || 92,
        condition: data.condition as DeviceCondition | null,
        modelCheck: data.modelCheck as string | undefined,
        modelCodeRead: data.modelCodeRead as string | null,
      };

      if (slot === 'front') {
        setFrontPhoto(photoResult);
      } else {
        setBackPhoto(photoResult);
      }
      setAnalysisStatus(data.clientConfirmedMismatch
        ? `${slot === 'front' ? 'Recto' : 'Verso'} enregistré : un gestionnaire vérifiera que c’est bien votre ${expectedDevice}.`
        : data.modelCheck === 'CODE_MATCH'
        ? `${slot === 'front' ? 'Recto' : 'Verso'} confirmé : numéro de modèle ${data.modelCodeRead} = ${expectedDevice}.`
        : `${slot === 'front' ? 'Recto' : 'Verso'} enregistré.`);
    } catch (err) {
      if (err instanceof PhotoRejection) {
        setSlotErrors((current) => ({ ...current, [slot]: { ...err.detail, previewUrl: shownUrl } }));
      } else {
        console.error(err);
        setErrorMsg(err instanceof Error ? err.message : 'Impossible d’enregistrer la photo.');
      }
    } finally {
      setIsUploading(false);
      window.setTimeout(() => setAnalysisStatus(''), 1400);
      setActiveSlot(null);
    }
  };

  const confirmMismatch = async (slot: Slot) => {
    const blob = rejectedFilesRef.current[slot];
    if (!blob) return;
    await processAndUpload(blob, slot, slotErrors[slot]?.previewUrl || URL.createObjectURL(blob), true);
  };

  const retake = (slot: Slot, source: 'camera' | 'file') => {
    setSlotErrors((current) => ({ ...current, [slot]: null }));
    if (source === 'camera') startCamera(slot);
    else {
      setActiveSlot(slot);
      fileInputRef.current?.click();
    }
  };

  const renderSlotError = (slot: Slot) => {
    const error = slotErrors[slot];
    if (!error) return null;
    return (
      <div role="alert" className="mb-4 overflow-hidden rounded-xl border border-red-300 bg-red-50 text-xs">
        <div className="flex gap-3 p-3">
          {error.previewUrl && <img src={error.previewUrl} alt="Photo refusée" className="h-24 w-20 shrink-0 rounded-lg object-cover ring-2 ring-red-300" />}
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Photo {SIDE_LABEL[slot]} refusée</p>
            <p className="flex items-center gap-1.5 text-sm font-bold text-red-800"><XCircle className="h-4 w-4 shrink-0" />{error.title}</p>
            <p className="mt-1 text-red-700">{error.message}</p>
            <p className="mt-1.5 text-slate-800"><strong>À faire :</strong> {error.hint}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-red-200 bg-white/70 p-2.5">
          <button type="button" onClick={() => retake(slot, 'camera')} className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white">Reprendre la photo</button>
          <button type="button" onClick={() => retake(slot, 'file')} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700">Choisir une autre image</button>
          {error.suggestFixDevice && (
            <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700">Corriger l’IMEI (étape 2)</button>
          )}
          {error.canConfirm && rejectedFilesRef.current[slot] && (
            <button type="button" disabled={isUploading} onClick={() => confirmMismatch(slot)} className="rounded-lg px-3 py-1.5 font-semibold text-red-700 underline decoration-dotted underline-offset-2">
              C’est bien mon téléphone : envoyer quand même (vérification par un gestionnaire)
            </button>
          )}
        </div>
      </div>
    );
  };

  /**
   * Preuve du modèle : seul le numéro de modèle imprimé (étiquette au dos) distingue des modèles au même boîtier.
   * Le recto ne le montre presque jamais : on le dit, sans afficher de faux « confirmé ».
   */
  const renderModelCheck = (photo: { modelCheck?: string; modelCodeRead?: string | null }, slot: Slot) => {
    if (photo.modelCheck === 'CODE_MATCH') {
      return (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Modèle confirmé : numéro {photo.modelCodeRead} = {expectedDevice}
        </p>
      );
    }
    if (slot === 'front') {
      return <p className="mt-2 text-[11px] text-slate-500">Le modèle se vérifie sur la photo du dos (numéro imprimé sur l’étiquette).</p>;
    }
    return (
      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
        <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Modèle non confirmé</p>
        <p className="mt-0.5">Le numéro de modèle n’est pas lisible sur cette photo. Reprenez le dos en gros plan sur l’étiquette (ex. « Model: 2209116AG »), sinon un gestionnaire vérifiera le modèle.</p>
      </div>
    );
  };

  /** Constat de l'état sous la photo acceptée : vert si rien, orange avec la liste des défauts sinon. */
  const renderCondition = (condition: DeviceCondition | null | undefined, slot: Slot) => {
    if (!condition) return null;
    const defects = conditionDefects(condition);
    const okText = slot === 'front' ? 'Écran allumé, affichage sans défaut visible' : 'Dos et objectifs sans défaut visible';
    return defects.length === 0 ? (
      <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{okText}
      </p>
    ) : (
      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
        <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Défaut constaté : {defects.join(', ')}</p>
        {condition.notes && <p className="mt-0.5">{condition.notes}</p>}
        <p className="mt-1 text-amber-800">Ce dommage existait avant la souscription : il sera signalé au gestionnaire et ne pourra pas être couvert.</p>
      </div>
    );
  };

  const handleNext = () => {
    if (!frontPhoto || !backPhoto) return;
    onComplete({
      frontPhoto: frontPhoto,
      backPhoto: backPhoto,
      challengeCode: challengeCode,
      qualityScore: Math.round(((frontPhoto.quality || 90) + (backPhoto.quality || 90)) / 2),
    });
  };

  // Dommage constaté : pas de passage automatique, le client doit voir le constat avant de continuer.
  const hasDefects = conditionDefects(frontPhoto?.condition).length + conditionDefects(backPhoto?.condition).length > 0
    || Boolean(backPhoto && backPhoto.modelCheck !== 'CODE_MATCH' && frontPhoto?.modelCheck !== 'CODE_MATCH');

  useEffect(() => {
    if (!frontPhoto || !backPhoto || isUploading || hasDefects) return;
    const timer = window.setTimeout(handleNext, 700);
    return () => window.clearTimeout(timer);
  }, [frontPhoto, backPhoto, isUploading]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 mb-3">
          <Camera className="w-3.5 h-3.5" /> Étape 3 : Contrôle visuel anti-fraude
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Vérifier et photographier
        </h1>
        <p className="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed">
          Session interactive anti-fraude, photo recto, photo verso, avec guide de cadrage et contrôle de qualité automatique.
        </p>
      </div>

      {/* Security challenge badge */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 text-white mb-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-blue-300">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-blue-200 uppercase tracking-wider">
              Défi de session anti-fraude
            </p>
            <p className="text-sm font-bold">
              Code de validité dynamique : <span className="font-mono bg-white/20 px-2 py-0.5 rounded text-amber-300">{challengeCode}</span>
            </p>
          </div>
        </div>

      </div>

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <Smartphone className="h-5 w-5 shrink-0 text-blue-600" />
        <span>Appareil à photographier : <strong className="text-slate-900">{expectedDevice}</strong>
          {deviceData?.maskedImei && <span className="text-slate-500"> · IMEI {deviceData.maskedImei}</span>}
          <span className="block text-slate-500">Les photos sont comparées automatiquement à ce modèle.</span></span>
      </div>

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        Le téléphone ne peut pas photographier son propre dos. Utilisez un second appareil ou importez une photo ; l’origine sera prise en compte pendant la revue.
      </div>

      {errorMsg && <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />{errorMsg}</div>}
      {analysisStatus && <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700"><RefreshCw className="h-4 w-4 animate-spin" />{analysisStatus}</div>}

      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Camera Live Modal Overlay */}
      {cameraActive && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-slate-900 rounded-3xl overflow-hidden border border-slate-800">
            {/* Phone guide silhouette overlay */}
            <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center p-6">
              <div className="w-48 h-80 rounded-[2.5rem] border-2 border-dashed border-white/80 shadow-2xl flex flex-col items-center justify-between p-4">
                <span className="text-[10px] text-white/90 bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  Placez le téléphone dans le cadre
                </span>
                <span className="text-xs text-amber-300 font-mono font-bold bg-black/70 px-2.5 py-1 rounded">
                  Code : {challengeCode}
                </span>
              </div>
            </div>

            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-96 object-cover"
            />

            <div className="p-4 bg-slate-900 flex items-center justify-between">
              <button
                type="button"
                onClick={stopCamera}
                className="text-slate-400 hover:text-white text-xs font-semibold px-4 py-2"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={captureCameraPhoto}
                className="w-14 h-14 rounded-full bg-white border-4 border-slate-300 flex items-center justify-center shadow-lg active:scale-90 transition-transform"
              >
                <div className="w-10 h-10 rounded-full bg-blue-600" />
              </button>

              <div className="w-16" />
            </div>
          </div>
        </div>
      )}

      {renderSlotError('front')}
      {renderSlotError('back')}

      {/* Two slots: Recto & Verso */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* Slot 1: Recto */}
        <div className={`border rounded-2xl p-4 bg-slate-50/60 flex flex-col justify-between ${slotErrors.front ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'}`}>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                1. Photo Recto (Écran)
              </span>
              {frontPhoto ? (
                conditionDefects(frontPhoto.condition).length ? (
                  <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Accepté · défaut constaté
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Conforme ({frontPhoto.quality}%)
                  </span>
                )
              ) : (
                <span className="text-[11px] text-slate-400">Requis</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Écran allumé avec date ou code visible pour certifier l’état de la vitre.
            </p>
          </div>

          {frontPhoto ? (
            <>
            <div className="relative rounded-xl overflow-hidden border border-slate-200 group aspect-[4/3] bg-black">
              <img
                src={frontPhoto.previewUrl}
                alt="Photo recto"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSlot('front');
                    if (fileInputRef.current) fileInputRef.current.click();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/90 text-slate-900 text-xs font-semibold shadow hover:bg-white"
                >
                  Remplacer
                </button>
              </div>
              <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-sm rounded px-2 py-0.5 text-[10px] text-white/80 font-mono truncate">
                SHA256 : {frontPhoto.sha256 ? frontPhoto.sha256.substring(0, 16) : 'calculé'}...
              </div>
            </div>
            {renderModelCheck(frontPhoto, 'front')}
            {renderCondition(frontPhoto.condition, 'front')}
            </>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => startCamera('front')}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <Camera className="w-4 h-4" />
                <span>Prendre la photo recto</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveSlot('front');
                  if (fileInputRef.current) fileInputRef.current.click();
                }}
                className="w-full py-2.5 rounded-xl border border-slate-300 hover:bg-white text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Téléverser depuis la galerie</span>
              </button>
            </div>
          )}
        </div>

        {/* Slot 2: Verso */}
        <div className={`border rounded-2xl p-4 bg-slate-50/60 flex flex-col justify-between ${slotErrors.back ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'}`}>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                2. Photo Verso (Dos)
              </span>
              {backPhoto ? (
                conditionDefects(backPhoto.condition).length ? (
                  <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Accepté · défaut constaté
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Conforme ({backPhoto.quality}%)
                  </span>
                )
              ) : (
                <span className="text-[11px] text-slate-400">Requis</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Dos de l’appareil et modules photo visibles, sans coque de protection.
            </p>
          </div>

          {backPhoto ? (
            <>
            <div className="relative rounded-xl overflow-hidden border border-slate-200 group aspect-[4/3] bg-black">
              <img
                src={backPhoto.previewUrl}
                alt="Photo verso"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSlot('back');
                    if (fileInputRef.current) fileInputRef.current.click();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/90 text-slate-900 text-xs font-semibold shadow hover:bg-white"
                >
                  Remplacer
                </button>
              </div>
              <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-sm rounded px-2 py-0.5 text-[10px] text-white/80 font-mono truncate">
                SHA256 : {backPhoto.sha256 ? backPhoto.sha256.substring(0, 16) : 'calculé'}...
              </div>
            </div>
            {renderModelCheck(backPhoto, 'back')}
            {renderCondition(backPhoto.condition, 'back')}
            </>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => startCamera('back')}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <Camera className="w-4 h-4" />
                <span>Prendre la photo verso</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveSlot('back');
                  if (fileInputRef.current) fileInputRef.current.click();
                }}
                className="w-full py-2.5 rounded-xl border border-slate-300 hover:bg-white text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Téléverser depuis la galerie</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour</span>
        </button>

        <button
          type="button"
          disabled={!frontPhoto || !backPhoto || isUploading}
          onClick={handleNext}
          className={`px-7 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md transition-all ${
            frontPhoto && backPhoto && !isUploading
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/25 active:scale-95'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isUploading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Enregistrement sécurisé...</span>
            </>
          ) : (
            <>
              <span>{hasDefects ? 'Continuer' : 'Validation automatique…'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
