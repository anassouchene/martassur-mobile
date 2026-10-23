'use client';

import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, Battery, Cpu, HardDrive, MemoryStick, Monitor, ShieldCheck, ShieldAlert, Smartphone, Fingerprint } from 'lucide-react';
import { DeviceDiagnostic, formatCapacity } from '@/lib/deviceDiagnostic';

interface DeviceDiagnosticCardProps {
  diagnostic: DeviceDiagnostic;
  /** IMEI lus via USB, masqués (ex. 86**********605). */
  maskedImeis?: string[];
  /** Repliable par un clic sur le titre (étape 2). Ouvert par défaut seulement s'il y a un point d'attention. */
  collapsible?: boolean;
}

const Row: React.FC<{ icon: React.ReactNode; label: string; value?: React.ReactNode; hint?: string }> = ({ icon, label, value, hint }) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
    <span className="flex items-center gap-1.5 text-slate-500">{icon}{label}</span>
    <span className="text-right">
      <span className={value ? 'font-semibold text-slate-900' : 'italic text-slate-400'}>{value || 'Non lu'}</span>
      {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
    </span>
  </div>
);

export const DeviceDiagnosticCard: React.FC<DeviceDiagnosticCardProps> = ({ diagnostic, maskedImeis, collapsible }) => {
  // Le navigateur ne publie qu'un code modèle (2209116AG, SM-S911U) : nom commercial via le catalogue TAC.
  const [catalog, setCatalog] = useState<{ brand: string; marketName: string } | null>(null);
  useEffect(() => {
    if (!diagnostic.model || diagnostic.marketName) return;
    fetch(`/api/devices/model-lookup?code=${encodeURIComponent(diagnostic.model)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setCatalog(data))
      .catch(() => undefined);
  }, [diagnostic.model, diagnostic.marketName]);
  const d: DeviceDiagnostic = catalog
    ? { ...diagnostic, brand: diagnostic.brand || catalog.brand, marketName: catalog.marketName }
    : diagnostic;
  const isUsb = d.source === 'USB_ADB';
  const battery = d.battery;
  const batteryParts = battery ? [
    battery.level != null ? `${battery.level} %` : null,
    battery.charging ? 'en charge' : null,
    battery.health ? `santé ${battery.health.toLowerCase()}` : null,
  ].filter(Boolean).join(' · ') : '';
  const batteryHint = battery ? [
    battery.capacityPercent != null ? `capacité restante ${battery.capacityPercent} %` : null,
    battery.cycleCount ? `${battery.cycleCount} cycles` : null,
    battery.temperatureC != null ? `${battery.temperatureC} °C` : null,
    battery.voltageMv ? `${(battery.voltageMv / 1000).toFixed(2)} V` : null,
  ].filter(Boolean).join(' · ') : '';
  const bootOk = d.verifiedBootState === 'green' && d.bootloaderLocked !== false;
  // Point d'attention = avertissement réel (hors mention générique « données du navigateur »), root ou système modifié.
  const alerts = d.warnings.filter((warning) => !warning.startsWith('Données fournies par le navigateur'));
  const needsAttention = alerts.length > 0 || d.hardware?.rooted === true || (isUsb && d.verifiedBootState != null && !bootOk);
  const [open, setOpen] = useState<boolean>(!collapsible || needsAttention);
  const deviceLabel = d.marketName || [d.brand, d.model].filter(Boolean).join(' ') || 'Appareil';

  return (
    <div className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-xs">
      <button type="button" onClick={() => collapsible && setOpen(!open)} aria-expanded={open} disabled={!collapsible}
        className={`flex w-full items-center justify-between gap-2 text-left ${open ? 'mb-3' : ''} ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-bold text-indigo-950">
            <Activity className="h-4 w-4 shrink-0 text-indigo-600" />
            Diagnostic de l’appareil {isUsb ? 'via USB (WebADB)' : 'via le navigateur du téléphone'}
          </span>
          {!open && (
            <span className="mt-0.5 block truncate pl-5 text-[11px] text-indigo-800">
              {deviceLabel}{alerts.length ? ` · ${alerts.length} point(s) d’attention` : ''}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isUsb ? 'bg-indigo-600 text-white' : 'bg-amber-100 text-amber-800'}`}>
            {isUsb ? 'Lu sur l’appareil' : 'Indicatif'}
          </span>
          {collapsible && <ChevronDown className={`h-4 w-4 text-indigo-600 transition-transform ${open ? 'rotate-180' : ''}`} />}
        </span>
      </button>

      {open && (<>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Row icon={<Smartphone className="h-3.5 w-3.5" />} label="Appareil"
          value={[d.marketName || [d.brand, d.model].filter(Boolean).join(' '), d.marketName && d.model ? `(${d.model})` : null].filter(Boolean).join(' ')
            || (!isUsb ? 'Masqué par le navigateur' : null)}
          hint={[d.modelSource, d.manufacturer && d.manufacturer !== d.brand ? `Fabricant ${d.manufacturer}` : null, d.device ? `code ${d.device}` : null].filter(Boolean).join(' · ')
            || (!isUsb && !d.model ? (d.desktopMode ? 'mode « Version pour ordinateur » activé' : 'navigateur sans identification du modèle') : undefined)} />
        <Row icon={<Cpu className="h-3.5 w-3.5" />} label="Système"
          value={d.androidVersion ? `Android ${d.androidVersion}${d.sdk ? ` (API ${d.sdk})` : ''}` : d.buildId}
          hint={d.securityPatch ? `Correctif sécurité ${d.securityPatch}` : undefined} />
        <Row icon={<Cpu className="h-3.5 w-3.5" />} label="Processeur"
          value={d.soc || (d.cpuCores ? `${d.cpuCores} cœurs` : null)}
          hint={[d.soc && d.cpuCores ? `${d.cpuCores} cœurs` : null, d.gpu].filter(Boolean).join(' · ') || undefined} />
        <Row icon={<MemoryStick className="h-3.5 w-3.5" />} label="Mémoire vive"
          value={d.ramGb ? `${d.ramGb} Go` : (!isUsb && d.ramRawGb ? `≥ ${d.ramRawGb} Go` : null)}
          hint={isUsb && d.ramRawGb ? `${d.ramRawGb} Go utilisables mesurés` : (!isUsb && d.ramRawGb ? 'valeur plafonnée par le navigateur' : undefined)} />
        <Row icon={<HardDrive className="h-3.5 w-3.5" />} label="Stockage"
          value={isUsb ? formatCapacity(d.storageGb) : 'Inaccessible au navigateur'}
          hint={[d.storageRawGb ? `${d.storageRawGb} Go mesurés · ${d.storageSource}` : null, d.dataUsedGb != null && d.dataFreeGb != null ? `${d.dataUsedGb} Go utilisés / ${d.dataFreeGb} Go libres` : null].filter(Boolean).join(' · ') || undefined} />
        <Row icon={<Monitor className="h-3.5 w-3.5" />} label="Écran"
          value={d.screenResolution ? `${d.screenResolution} px` : null}
          hint={d.screenDensity ? `${d.screenDensity} dpi` : undefined} />
        <Row icon={<Battery className="h-3.5 w-3.5" />} label="Batterie" value={batteryParts || null} hint={batteryHint || undefined} />
        {isUsb && (
          <Row icon={bootOk ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />} label="Intégrité système"
            value={d.verifiedBootState ? (bootOk ? 'Bootloader verrouillé' : 'Bootloader déverrouillé / modifié') : null}
            hint={d.verifiedBootState ? `Verified boot : ${d.verifiedBootState}` : undefined} />
        )}
        {isUsb && (
          <Row icon={<Fingerprint className="h-3.5 w-3.5" />} label="IMEI lu par USB"
            value={maskedImeis?.length ? maskedImeis.join(' · ') : (d.imeiRead === 'DENIED' ? 'Refusé par Android' : null)}
            hint={maskedImeis?.length ? 'Lu sur l’appareil, prérempli ci-dessous' : 'Saisie ou scan nécessaire'} />
        )}
      </div>

      {isUsb && d.hardware && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="font-semibold text-slate-700">Composants présents (déclarés par Android)</p>
          <p className="mb-2 text-[10px] text-slate-500">Présence du matériel, pas son bon fonctionnement : les tests réels se font avec « Lancer le diagnostic » sur le téléphone.</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(d.hardware.components).map(([name, present]) => (
              <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${present ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400 line-through'}`}>{name}</span>
            ))}
            {d.hardware.touchController != null && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.hardware.touchController ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {d.hardware.touchController ? 'Contrôleur tactile détecté' : 'Contrôleur tactile non détecté'}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {[d.hardware.simState && `SIM ${d.hardware.simState}`,
              d.hardware.rooted != null && (d.hardware.rooted ? 'root détecté' : 'non rooté'),
              d.hardware.screenOn != null && `écran ${d.hardware.screenOn ? 'allumé' : 'en veille'}`,
              d.hardware.uptimeHours != null && `allumé depuis ${d.hardware.uptimeHours} h`].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {d.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-indigo-800">
          {d.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{warning}</li>
          ))}
        </ul>
      )}
      </>)}
    </div>
  );
};
