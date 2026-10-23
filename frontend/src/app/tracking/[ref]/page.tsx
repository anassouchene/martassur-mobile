'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ShieldCheck, Smartphone, CheckCircle, Clock, AlertCircle, FileText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function TrackingPage() {
  const params = useParams();
  const ref = params?.ref as string;

  const [loading, setLoading] = useState<boolean>(true);
  const [appData, setAppData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (ref) {
      fetchApp(ref);
    }
  }, [ref]);

  const fetchApp = async (appRef: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/insurance-applications/${appRef}`);
      if (!res.ok) throw new Error('Dossier introuvable');
      const data = await res.json();
      setAppData(data);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Dossier introuvable ou numéro de suivi invalide.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Retour à l'accueil</span>
        </Link>

        {loading ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Chargement du dossier...</p>
          </div>
        ) : errorMsg ? (
          <div className="bg-white rounded-3xl border border-red-200 p-8 text-center text-red-600 space-y-3">
            <AlertCircle className="w-10 h-10 mx-auto" />
            <h2 className="text-base font-bold">{errorMsg}</h2>
          </div>
        ) : appData ? (
          <div className="space-y-6">
            {/* Header Status Card */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Suivi de Demande d'Assurance
                  </span>
                  <h1 className="text-2xl font-black text-slate-900 mt-1">
                    Dossier {appData.applicationRef}
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Souscripteur : <strong>{appData.clientName}</strong>
                  </p>
                </div>

                <div>
                  {appData.status === 'APPROVED' ? (
                    <span className="px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600" /> Contrat Validé
                    </span>
                  ) : appData.status === 'MORE_DOCS_NEEDED' ? (
                    <span className="px-4 py-2 rounded-xl text-xs font-extrabold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-600" /> Pièces Requises
                    </span>
                  ) : appData.status === 'REJECTED' ? (
                    <span className="px-4 py-2 rounded-xl text-xs font-extrabold bg-red-100 text-red-800 border border-red-300 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-red-600" /> Non Validé
                    </span>
                  ) : (
                    <span className="px-4 py-2 rounded-xl text-xs font-extrabold bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-600" /> En cours d'examen
                    </span>
                  )}
                </div>
              </div>

              {/* Device and specs info */}
              {appData.device && (
                <div className="py-6 border-b border-slate-100">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Smartphone Couvert
                  </h3>
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
                        <Smartphone className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          {appData.device.brand} {appData.device.model}
                        </h4>
                        <p className="text-xs text-slate-500">
                          Stockage : {appData.device.storage} • Batterie : {appData.device.batteryMah} mAh
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-mono bg-white px-2.5 py-1 rounded border border-slate-200 text-slate-700 block">
                        TAC : {appData.device.tac}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Checks & proofs summary */}
              <div className="pt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Contrôles Automatiques & Journal d'Audit
                </h3>
                <div className="space-y-2">
                  {appData.checks?.map((c: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                        <span className="font-semibold text-slate-800">{c.kind}</span>
                      </div>
                      <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        {c.outcome}
                      </span>
                    </div>
                  ))}

                  {appData.logs?.map((l: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-600"
                    >
                      <span>
                        <strong>{l.reviewer}</strong> : {l.reason}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(l.date).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

