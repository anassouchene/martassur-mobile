'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { DeviceDiagnosticCard } from '@/components/DeviceDiagnosticCard';
import { FunctionalTestsCard } from '@/components/FunctionalTestsCard';
import {
  AlertTriangle, ArrowLeft, CheckCircle, Clock, Filter, History, Image as ImageIcon, Lock, LogOut, RefreshCw,
  Search, ShieldAlert, ShieldCheck, Smartphone, User, XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { CONDITION_LABELS, conditionDefects, conditionFromAnalysis } from '@/lib/deviceCondition';

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'À examiner', APPROVED: 'Validé', MORE_DOCS_NEEDED: 'Pièces demandées', REJECTED: 'Rejeté', DOSSIER_CREE: 'Dossier créé',
};
const RISK_LABEL: Record<string, string> = { LOW: 'Faible', MEDIUM: 'Moyen', HIGH: 'Élevé', INCOHERENT: 'Incohérent' };
const MODE_LABEL: Record<string, string> = { WEB_QR: 'QR code', WEB_DIRECT: 'Lien direct mobile', USB_ADB: 'USB Android' };
const CHECK_LABEL: Record<string, string> = {
  LUHN_ALGORITHM: 'Clé de contrôle Luhn', TAC_CONSISTENCY: 'TAC dans le catalogue', IMEI_USB_READ: 'IMEI lu via USB', DEVICE_MODEL_TAC: 'Modèle de l’appareil ↔ TAC',
};
const RISK_EVENT_LABEL: Record<string, string> = {
  DUPLICATE_IMEI: 'IMEI déjà assuré', USB_IMEI_MISMATCH: 'IMEI ≠ IMEI lu via USB', DEVICE_TAC_MISMATCH: 'Marque appareil ≠ TAC',
  PHOTO_BRAND_MISMATCH: 'Photo : autre marque', PHOTO_MODEL_MISMATCH: 'Photo : autre modèle', PRE_EXISTING_DAMAGE: 'Dommage / panne préexistant', MODEL_NOT_CONFIRMED: 'Modèle non prouvé',
};

const riskClass = (risk?: string) =>
  risk === 'LOW' ? 'bg-emerald-100 text-emerald-800' : risk === 'MEDIUM' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
const statusClass = (status?: string) =>
  status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'MORE_DOCS_NEEDED' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-blue-50 text-blue-700 border-blue-200';
const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca', dateStyle: 'short', timeStyle: 'short' }) : '';

/** fetch qui signale l'expiration de session (401) au lieu de renvoyer une erreur muette. */
const useAdminFetch = (onUnauthorized: () => void) =>
  useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) onUnauthorized();
    return response;
  }, [onUnauthorized]);

function LoginForm({ onLogged }: { onLogged: (user: any) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 429) throw new Error('Trop de tentatives. Réessayez dans une minute.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Connexion impossible.');
      onLogged(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-10 max-w-sm space-y-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white"><Lock className="h-6 w-6" /></div>
        <h1 className="text-xl font-black text-slate-900">Espace Gestionnaire</h1>
        <p className="text-xs text-slate-500">Accès réservé aux gestionnaires SmartAssur.</p>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      <label className="block text-xs font-bold text-slate-700">Identifiant
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
      </label>
      <label className="block text-xs font-bold text-slate-700">Mot de passe
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
      </label>
      <button disabled={submitting} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
        {submitting ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}

/** Barre horizontale étiquetée (part d'un total). */
function ShareBar({ label, count, total, barClass }: { label: string; count: number; total: number; barClass: string }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="text-xs">
      <div className="mb-1 flex justify-between text-slate-600"><span>{label}</span><span className="font-semibold text-slate-900">{count} · {percent} %</span></div>
      <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${barClass}`} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function DailyChart({ daily }: { daily: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.count));
  const total = daily.reduce((sum, d) => sum + d.count, 0);
  const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-slate-900">Dossiers déposés — 30 derniers jours</h3>
        <span className="text-xs text-slate-500">{hover !== null ? `${label(daily[hover].date)} : ${daily[hover].count} dossier(s)` : `${total} au total`}</span>
      </div>
      <div className="flex h-56 items-end gap-[2px] border-b border-slate-200" onMouseLeave={() => setHover(null)}>
        {daily.map((d, index) => (
          <div key={d.date} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(index)}
            title={`${label(d.date)} : ${d.count} dossier(s)`}>
            <div className={`w-full rounded-t ${hover === index ? 'bg-blue-700' : 'bg-blue-500'}`}
              style={{ height: d.count ? `${Math.max(4, (d.count / max) * 100)}%` : '0' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>{daily[0] && label(daily[0].date)}</span><span>Aujourd’hui</span></div>
    </div>
  );
}

function DetailModal({ id, adminFetch, onClose, onDecided }: { id: string; adminFetch: ReturnType<typeof useAdminFetch>; onClose: () => void; onDecided: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showImei, setShowImei] = useState(false);

  const load = useCallback(async () => {
    const response = await adminFetch(`/api/admin/insurance-applications/${id}`);
    if (response.ok) setDetail(await response.json());
    else if (response.status !== 401) setError('Dossier introuvable.');
  }, [adminFetch, id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (action: string) => {
    setSaving(true);
    setError('');
    const response = await adminFetch(`/api/admin/insurance-applications/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, decisionReason: reason }),
    });
    setSaving(false);
    if (response.ok) {
      setReason('');
      await load();
      onDecided();
    } else if (response.status !== 401) {
      setError((await response.json().catch(() => ({}))).message || 'Décision non enregistrée.');
    }
  };

  const paired = detail?.session?.paired;
  const diagnostic = paired?.diagnostic;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        {!detail ? (
          <div className="py-16 text-center text-sm text-slate-400">{error || <><RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-blue-600" />Chargement du dossier…</>}</div>
        ) : (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Dossier</span>
                <h2 className="font-mono text-xl font-black text-slate-900">{detail.applicationRef}</h2>
                <p className="text-xs text-slate-500">Déposé le {formatDate(detail.createdAt)} · {MODE_LABEL[detail.verificationMode] || detail.verificationMode}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${statusClass(detail.status)}`}>{STATUS_LABEL[detail.status] || detail.status}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${riskClass(detail.riskLevel)}`}>
                  Risque {RISK_LABEL[detail.riskLevel] || detail.riskLevel}{detail.score != null && ` · ${detail.score}/100`}
                </span>
                <button onClick={onClose} aria-label="Fermer" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <section className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-900"><User className="h-4 w-4" />Souscripteur</h3>
                <p><strong>{detail.clientName}</strong></p>
                <p className="text-slate-600">{detail.clientEmail}</p>
                <p className="text-slate-600">{detail.clientPhone}</p>
              </section>
              <section className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-900"><Smartphone className="h-4 w-4" />Appareil déclaré</h3>
                <p><strong>{detail.device?.brand} {detail.device?.model}</strong></p>
                <p className="text-slate-600">{[detail.device?.storage, detail.device?.ram && `${detail.device.ram} RAM`, detail.device?.batteryMah && `${detail.device.batteryMah} mAh`].filter(Boolean).join(' · ')}</p>
                <p className="font-mono text-slate-700">
                  IMEI {showImei ? detail.device?.imei : detail.device?.maskedImei} · TAC {detail.device?.tac}
                  {detail.device?.imei && <button onClick={() => setShowImei(!showImei)} className="ml-2 font-sans text-[11px] font-semibold text-blue-600">{showImei ? 'masquer' : 'afficher'}</button>}
                </p>
                {detail.device?.otherApplicationsWithSameImei > 0 && (
                  <p className="font-semibold text-red-700">IMEI présent dans {detail.device.otherApplicationsWithSameImei} autre(s) dossier(s).</p>
                )}
              </section>
            </div>

            {detail.device?.sources?.length > 0 && (
              <section className="text-xs">
                <h3 className="mb-2 text-sm font-bold text-slate-900">Provenance des données</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {detail.device.sources.map((s: any) => (
                    <div key={s.field} className="flex justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-slate-500">{s.field}</span>
                      <span className="text-right font-semibold text-slate-800">{s.detail} <span className="text-[10px] font-normal text-slate-400">({s.confidence})</span></span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {paired?.functionalTests && <FunctionalTestsCard report={paired.functionalTests} />}
            {diagnostic ? (
              <DeviceDiagnosticCard diagnostic={diagnostic} maskedImeis={paired?.usbImeisMasked} />
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">Aucun diagnostic d’appareil enregistré pour cette session (dossier antérieur au diagnostic ou session sans appairage).</p>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><ImageIcon className="h-4 w-4" />Photos</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {detail.evidences?.map((e: any) => (
                  <figure key={e.id} className="overflow-hidden rounded-2xl border border-slate-200 text-xs">
                    <a href={e.previewUrl} target="_blank" rel="noreferrer"><img src={e.previewUrl} alt={e.type} className="h-56 w-full bg-slate-100 object-contain" /></a>
                    <figcaption className="space-y-0.5 p-2.5">
                      <p className="font-bold text-slate-900">{e.type === 'PHOTO_FRONT' ? 'Recto' : e.type === 'PHOTO_BACK' ? 'Verso' : e.type} · qualité {e.quality} %</p>
                      <p className="text-slate-500">{formatDate(e.capturedAt)} · {e.source} · {Math.round(e.fileSize / 1024)} Ko</p>
                      {e.qualityFlags?.modelCheck && (
                        <p className={`rounded-lg px-2 py-1 font-semibold ${e.qualityFlags.modelCheck === 'CODE_MATCH' ? 'bg-emerald-50 text-emerald-800' : e.qualityFlags.modelCheck === 'CODE_MISMATCH' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                          {e.qualityFlags.modelCheck === 'CODE_MATCH' ? `Numéro de modèle lu : ${e.qualityFlags.modelCodeRead} (concordant avec l’IMEI)`
                            : e.qualityFlags.modelCheck === 'CODE_MISMATCH' ? `Numéro de modèle lu : ${e.qualityFlags.modelCodeRead} — ${e.qualityFlags.observedName ?? 'autre modèle'} (client a confirmé malgré l’écart)`
                            : 'Numéro de modèle illisible sur cette photo'}
                        </p>
                      )}
                      {(() => {
                        const condition = conditionFromAnalysis(e.qualityFlags?.antigravity?.Result ?? e.qualityFlags?.antigravity?.result);
                        if (!condition) return null;
                        const defects = conditionDefects(condition);
                        return (
                          <div className={`rounded-lg px-2 py-1.5 ${defects.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                            <p className="font-semibold">
                              État : {CONDITION_LABELS[condition.overallCondition || ''] || 'non évalué'}
                              {e.type === 'PHOTO_FRONT' && condition.screenOn != null && <> · écran {condition.screenOn ? 'allumé' : 'éteint'}</>}
                            </p>
                            <p>{defects.length ? `Défauts : ${defects.join(', ')}` : 'Aucun défaut visible'}</p>
                            {condition.notes && <p className="text-[11px] opacity-80">{condition.notes}</p>}
                          </div>
                        );
                      })()}
                      <p className="break-all font-mono text-[10px] text-slate-400">SHA-256 {e.sha256}</p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><ShieldCheck className="h-4 w-4" />Contrôles automatiques</h3>
                <ul className="space-y-1.5">
                  {detail.checks?.map((c: any, index: number) => (
                    <li key={index} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span>{CHECK_LABEL[c.kind] || c.kind}</span>
                      <span className={`font-bold ${c.outcome === 'PASSED' ? 'text-emerald-700' : c.outcome === 'FAILED' ? 'text-red-700' : 'text-amber-700'}`}>
                        {c.outcome === 'PASSED' ? 'Conforme' : c.outcome === 'FAILED' ? 'Échec' : 'À vérifier'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><ShieldAlert className="h-4 w-4" />Alertes de risque</h3>
                {detail.riskEvents?.length ? (
                  <ul className="space-y-1.5">
                    {detail.riskEvents.map((r: any, index: number) => (
                      <li key={index} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                        <strong>{RISK_EVENT_LABEL[r.code] || r.code}</strong> · {r.severity}<br />{r.reason}
                      </li>
                    ))}
                  </ul>
                ) : <p className="rounded-lg border border-slate-200 px-3 py-2 text-slate-500">Aucune alerte.</p>}
                {detail.notes && <p className="mt-2 text-slate-500">{detail.notes}</p>}
              </section>
            </div>

            <section className="text-xs">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><History className="h-4 w-4" />Historique du dossier</h3>
              <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                {detail.logs?.map((l: any, index: number) => (
                  <li key={index} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white" />
                    <p><strong>{STATUS_LABEL[l.action] || l.action}</strong> · {l.reviewer === 'SYSTEM_AUTOMATION' ? 'Système' : l.reviewer} · <span className="text-slate-500">{formatDate(l.date)}</span></p>
                    {l.reason && <p className="text-slate-600">{l.reason}</p>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="space-y-3 border-t border-slate-100 pt-4">
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
              <label className="block text-xs font-bold text-slate-700">Motif de la décision (tracé dans l’historique)
                <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex : photos nettes et conformes, TAC cohérent, contrat accordé."
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-xs font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button disabled={saving} onClick={() => decide('APPROVED')} className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><CheckCircle className="h-4 w-4" />Valider le contrat</button>
                <button disabled={saving} onClick={() => decide('MORE_DOCS_NEEDED')} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 py-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"><Clock className="h-4 w-4" />Demander des pièces</button>
                <button disabled={saving} onClick={() => decide('REJECTED')} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 py-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"><XCircle className="h-4 w-4" />Rejeter</button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [user, setUser] = useState<any>(undefined); // undefined = vérification en cours, null = non connecté
  const [stats, setStats] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterRisk, setFilterRisk] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => setUser(null), []);
  const adminFetch = useAdminFetch(handleUnauthorized);

  useEffect(() => {
    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then(async (response) => setUser(response.ok ? await response.json() : null))
      .catch(() => setUser(null));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterRisk) params.set('riskLevel', filterRisk);
    try {
      const [statsResponse, listResponse, activityResponse] = await Promise.all([
        adminFetch('/api/admin/stats'),
        adminFetch(`/api/admin/insurance-applications?${params}`),
        adminFetch('/api/admin/activity?limit=20'),
      ]);
      if (statsResponse.ok) setStats(await statsResponse.json());
      if (listResponse.ok) setApplications(await listResponse.json());
      if (activityResponse.ok) setActivity(await activityResponse.json());
    } finally {
      setLoading(false);
    }
  }, [adminFetch, filterStatus, filterRisk]);

  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  const logout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const filteredList = applications.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return [a.applicationRef, a.clientName, a.clientEmail, a.clientPhone, a.device, a.tac].some((v) => v?.toLowerCase().includes(q));
  });

  if (user === undefined) {
    return (<><Navbar /><main className="flex-1 py-24 text-center text-sm text-slate-400"><RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-blue-600" />Vérification de la session…</main></>);
  }
  if (user === null) {
    return (<><Navbar /><main className="flex-1 px-4 py-8"><LoginForm onLogged={setUser} /></main></>);
  }

  const kpis = stats ? [
    { label: 'Total dossiers', value: stats.total, tone: 'border-slate-200 text-slate-900' },
    { label: 'À examiner', value: stats.pending, tone: 'border-blue-200 text-blue-800' },
    { label: 'Validés', value: stats.approved, tone: 'border-emerald-200 text-emerald-800' },
    { label: 'Pièces demandées', value: stats.moreDocs, tone: 'border-amber-200 text-amber-800' },
    { label: 'Rejetés', value: stats.rejected, tone: 'border-red-200 text-red-800' },
    { label: 'Score moyen', value: stats.avgScore != null ? `${stats.avgScore}/100` : '—', tone: 'border-slate-200 text-slate-900' },
    { label: 'Délai moyen de décision', value: stats.avgDecisionHours != null ? `${stats.avgDecisionHours} h` : '—', tone: 'border-slate-200 text-slate-900' },
    { label: 'Alertes anti-fraude', value: (stats.riskEvents || []).reduce((sum: number, r: any) => sum + r.count, 0), tone: 'border-red-200 text-red-800' },
  ] : [];
  const riskOrder = ['LOW', 'MEDIUM', 'HIGH', 'INCOHERENT'];
  const riskBar: Record<string, string> = { LOW: 'bg-emerald-500', MEDIUM: 'bg-amber-500', HIGH: 'bg-orange-600', INCOHERENT: 'bg-red-600' };

  return (
    <>
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <span className="rounded border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">Backoffice Assurance</span>
            <h1 className="mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl">Espace Gestionnaire SmartAssur</h1>
            <p className="mt-0.5 text-xs text-slate-500">Connecté : <strong>{user.displayName || user.username}</strong> ({user.role})</p>
          </div>
          <div className="flex gap-2">
            <button onClick={refresh} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualiser</button>
            <Link href="/" className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Parcours client</Link>
            <button onClick={logout} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"><LogOut className="h-4 w-4" />Déconnexion</button>
          </div>
        </div>

        {stats && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kpis.map((kpi) => (
                <div key={kpi.label} className={`rounded-2xl border bg-white p-4 shadow-sm ${kpi.tone}`}>
                  <span className="block text-xs font-medium text-slate-500">{kpi.label}</span>
                  <span className="mt-1 block text-2xl font-black">{kpi.value}</span>
                </div>
              ))}
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2"><DailyChart daily={stats.daily || []} /></div>
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold text-slate-900">Niveau de risque</h3>
                  {riskOrder.map((risk) => {
                    const count = stats.byRisk?.find((r: any) => r.key === risk)?.count || 0;
                    return <ShareBar key={risk} label={RISK_LABEL[risk]} count={count} total={stats.total} barClass={riskBar[risk]} />;
                  })}
                </div>
                <div className="space-y-2.5">
                  <h3 className="text-sm font-bold text-slate-900">Mode de détection</h3>
                  {Object.keys(MODE_LABEL).map((mode) => {
                    const count = stats.byMode?.find((m: any) => m.key === mode)?.count || 0;
                    return <ShareBar key={mode} label={MODE_LABEL[mode]} count={count} total={stats.total} barClass="bg-blue-500" />;
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Référence, client, téléphone, TAC…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-4 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Filter className="h-4 w-4 text-slate-400" />
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none">
                  <option value="">Tous les statuts</option>
                  {['PENDING_REVIEW', 'APPROVED', 'MORE_DOCS_NEEDED', 'REJECTED'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none">
                  <option value="">Tous les risques</option>
                  {riskOrder.map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
                </select>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Référence</th><th className="px-4 py-3">Souscripteur</th><th className="px-4 py-3">Smartphone</th>
                      <th className="px-4 py-3">Risque</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading && !applications.length ? (
                      <tr><td colSpan={6} className="py-10 text-center text-slate-400">Chargement des dossiers…</td></tr>
                    ) : filteredList.length === 0 ? (
                      <tr><td colSpan={6} className="py-10 text-center text-slate-400">Aucun dossier ne correspond aux critères.</td></tr>
                    ) : filteredList.map((app) => (
                      <tr key={app.id} className="cursor-pointer hover:bg-slate-50/80" onClick={() => setSelectedId(app.id)}>
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-blue-700">{app.applicationRef}</div>
                          <div className="text-[10px] text-slate-400">{formatDate(app.createdAt)} · {MODE_LABEL[app.verificationMode] || app.verificationMode}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900"><div>{app.clientName}</div><div className="text-[10px] text-slate-400">{app.clientPhone}</div></td>
                        <td className="px-4 py-3 text-slate-700">{app.device}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${riskClass(app.riskLevel)}`}>{RISK_LABEL[app.riskLevel] || app.riskLevel}{app.score != null && ` · ${app.score}`}</span>
                          {app.riskEventCodes?.map((code: string) => <div key={code} className="mt-1 text-[10px] font-semibold text-red-700">{RISK_EVENT_LABEL[code] || code}</div>)}
                        </td>
                        <td className="px-4 py-3"><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${statusClass(app.status)}`}>{STATUS_LABEL[app.status] || app.status}</span></td>
                        <td className="px-4 py-3 text-right"><span className="rounded-lg bg-blue-50 px-3 py-1.5 font-semibold text-blue-700">Examiner</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-900"><History className="h-4 w-4" />Historique récent</h3>
            {activity.length === 0 ? <p className="text-xs text-slate-400">Aucune activité.</p> : (
              <ol className="space-y-3 border-l-2 border-slate-200 pl-4 text-xs">
                {activity.map((a, index) => (
                  <li key={index} className="relative cursor-pointer" onClick={() => setSelectedId(a.applicationId)}>
                    <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${a.reviewer === 'SYSTEM_AUTOMATION' ? 'bg-slate-400' : 'bg-blue-500'}`} />
                    <p><strong className="font-mono text-blue-700">{a.applicationRef}</strong> · {STATUS_LABEL[a.action] || a.action}</p>
                    <p className="text-slate-500">{a.reviewer === 'SYSTEM_AUTOMATION' ? 'Système' : a.reviewer} · {formatDate(a.date)}</p>
                    {a.reason && a.reviewer !== 'SYSTEM_AUTOMATION' && <p className="text-slate-600">« {a.reason} »</p>}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>

        {(stats?.riskEvents?.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50/60 p-4 text-xs text-red-800">
            <AlertTriangle className="h-4 w-4" />
            {stats.riskEvents.map((r: any) => <span key={r.key} className="rounded bg-white px-2 py-0.5 font-semibold">{RISK_EVENT_LABEL[r.key] || r.key} : {r.count}</span>)}
          </div>
        )}

        {selectedId && <DetailModal id={selectedId} adminFetch={adminFetch} onClose={() => setSelectedId(null)} onDecided={refresh} />}
      </main>
    </>
  );
}
