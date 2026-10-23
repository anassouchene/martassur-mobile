'use client';

import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { Send, CheckCircle2, Shield, Lock, FileText, ArrowLeft, RefreshCw, AlertCircle, Smartphone, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface Step4SubmitProps {
  deviceData: any;
  evidenceData: any;
  sessionData: any;
  onBack: () => void;
  onSubmitted?: () => void;
}

export const Step4Submit: React.FC<Step4SubmitProps> = ({ deviceData, evidenceData, sessionData, onBack, onSubmitted }) => {
  const [clientName, setClientName] = useState<string>('');
  const [clientEmail, setClientEmail] = useState<string>('');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [consentCndp, setConsentCndp] = useState<boolean>(false);
  const [consentTerms, setConsentTerms] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentCndp || !consentTerms) {
      setErrorMsg('Veuillez accepter les conditions et le traitement de vos données pour continuer.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const payload = {
        sessionToken: sessionData?.sessionToken,
        clientName,
        clientEmail,
        clientPhone,
        imei: deviceData.imei,
        brand: deviceData.brand,
        model: deviceData.model,
        ramGb: deviceData.ram,
        storageGb: deviceData.storage,
        batteryMah: deviceData.batteryMah,
        frontPhotoEvidenceId: evidenceData?.frontPhoto?.id || null,
        backPhotoEvidenceId: evidenceData?.backPhoto?.id || null,
        verificationMode: sessionData?.mode || 'WEB_QR',
        consentCndp: true,
      };

      const res = await fetch('/api/insurance-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Erreur lors de la soumission');
      }

      const data = await res.json();
      setSubmissionResult(data);
      onSubmitted?.();

      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch (e) {}
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Échec de transmission du dossier. Vérifiez les informations.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-sm max-w-2xl mx-auto">
      {!submissionResult ? (
        <>
          <div className="text-center mb-8">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 mb-3">
              <Send className="w-3.5 h-3.5" /> Étape 4 : Finalisation et transmission
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Envoyer ma demande
            </h1>
            <p className="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed">
              Récapitulatif, consentement, transmission du dossier et numéro de suivi.
            </p>
          </div>

          {/* Detailed summary card */}
          <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-2xl p-5 border border-slate-200 mb-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">
                    {deviceData.brand} {deviceData.marketName || deviceData.model}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Variante : <strong>{deviceData.storage}</strong> • RAM : <strong>{deviceData.ram}</strong>
                  </p>
                </div>
              </div>

              <span className="text-[11px] font-mono bg-white px-2 py-1 rounded border border-slate-200 text-slate-700">
                IMEI : {deviceData.maskedImei}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/80 text-xs">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Photos reçues</span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Recto & verso à examiner
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Contrôle anti-fraude</span>
                <span className="font-semibold text-blue-700 flex items-center gap-1 mt-0.5">
                  <Shield className="w-3.5 h-3.5" /> Revue humaine requise
                </span>
              </div>
            </div>
          </div>

          {/* Client info inputs */}
          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Coordonnées du souscripteur
            </h4>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Nom et Prénom *
              </label>
              <input
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Adresse e-mail *
                </label>
                <input
                  type="email"
                  required
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Téléphone mobile *
                </label>
                <input
                  type="tel"
                  required
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>
            </div>

            {/* Legal consents */}
            <div className="pt-2 space-y-2.5 text-xs text-slate-600">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentTerms}
                  onChange={(e) => setConsentTerms(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  J'accepte les <strong>Conditions Générales d'Assurance Smartphone</strong> et certifie l'exactitude des informations relatives à mon appareil.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentCndp}
                  onChange={(e) => setConsentCndp(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  Conformément à la loi 09-08 (CNDP), j'autorise le traitement sécurisé de mon IMEI et de mes pièces justificatives aux seules fins de gestion de mon contrat.
                </span>
              </label>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Submit & Back buttons */}
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
                type="submit"
                disabled={submitting}
                className="px-8 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 flex items-center gap-2 active:scale-95 transition-all"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Transmission sécurisée...</span>
                  </>
                ) : (
                  <>
                    <span>Envoyer ma demande</span>
                    <Send className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </>
      ) : (
        /* Success Screen */
        <div className="text-center py-6 space-y-6">
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              Dossier Transmis avec Succès
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mt-3">
              Demande enregistrée
            </h2>
            <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
              Votre dossier de souscription a été pris en compte. Les contrôles d'assurance sont en cours d'exécution.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-left max-w-md mx-auto space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="text-xs text-slate-500">Numéro de suivi :</span>
              <span className="font-mono font-bold text-base text-blue-700">
                {submissionResult.applicationRef}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="text-xs text-slate-500">Statut initial :</span>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {submissionResult.statusLabel || "En cours d'examen"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Niveau de confiance :</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
                submissionResult.riskLevel === 'LOW'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : submissionResult.riskLevel === 'MEDIUM'
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-red-700 bg-red-50 border-red-200'
              }`}>
                {submissionResult.confidenceLabel || '—'}
              </span>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={`/tracking/${submissionResult.applicationRef}`}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <span>Suivre mon dossier</span>
              <ExternalLink className="w-4 h-4" />
            </Link>

            <Link
              href="/admin"
              className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all"
            >
              <span>Voir dans l'espace gestionnaire</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

