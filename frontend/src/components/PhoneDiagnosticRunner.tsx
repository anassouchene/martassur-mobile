'use client';

import React, { useRef, useState } from 'react';
import { RefreshCw, Stethoscope } from 'lucide-react';
import { FunctionalTestsCard } from '@/components/FunctionalTestsCard';
import {
  FunctionalTest, FunctionalTestReport, testAudioLoopback, testBatteryAndNetwork, testCamera, testMotionAndVibration, touchTestResult,
} from '@/lib/functionalTests';

const COLUMNS = 4;
const ROWS = 7;
const TOUCH_SECONDS = 20;
const RETRY_SECONDS = 10;

interface PhoneDiagnosticRunnerProps {
  sessionToken: string;
  challengeCode: string;
}

/** Bouton « Lancer le diagnostic » : enchaîne les tests puis envoie le rapport à la session (affiché sur le PC). */
export const PhoneDiagnosticRunner: React.FC<PhoneDiagnosticRunnerProps> = ({ sessionToken, challengeCode }) => {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [partial, setPartial] = useState<FunctionalTest[]>([]);
  const [report, setReport] = useState<FunctionalTestReport | null>(null);
  const [sendError, setSendError] = useState('');
  const [touchCells, setTouchCells] = useState<boolean[] | null>(null);
  const [touchLeft, setTouchLeft] = useState(TOUCH_SECONDS);
  // Seconde chance : les zones restantes clignotent avant de conclure « Défaillant ».
  const [touchRetry, setTouchRetry] = useState(false);
  const touchStartedRef = useRef(false);
  // Écran d'introduction : le plein écran exige un toucher du client (règle des navigateurs).
  const [touchIntro, setTouchIntro] = useState(false);
  const touchResolveRef = useRef<((result: FunctionalTest) => void) | null>(null);
  const cellsRef = useRef<boolean[]>([]);

  const finishTouch = (skipped: boolean) => {
    const resolve = touchResolveRef.current;
    touchResolveRef.current = null;
    setTouchCells(null);
    setTouchIntro(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    (screen.orientation as any)?.unlock?.();
    resolve?.(touchTestResult(cellsRef.current, COLUMNS, skipped));
  };

  /**
   * Grille plein écran : le client glisse le doigt partout, chaque zone touchée devient verte.
   * Le chrono part au premier toucher ; à la fin, les zones manquantes clignotent 10 s avant d'être déclarées mortes.
   */
  const runTouchTest = () => new Promise<FunctionalTest>((resolve) => {
    cellsRef.current = Array(COLUMNS * ROWS).fill(false);
    touchResolveRef.current = resolve;
    touchStartedRef.current = false;
    setTouchRetry(false);
    setTouchIntro(true);
    setTouchCells([...cellsRef.current]);
    setTouchLeft(TOUCH_SECONDS);
    let left = TOUCH_SECONDS;
    let retrying = false;
    const timer = window.setInterval(() => {
      if (!touchResolveRef.current) return window.clearInterval(timer);
      if (!touchStartedRef.current) return;
      left -= 1;
      setTouchLeft(left);
      if (left > 0) return;
      if (!retrying && cellsRef.current.some((touched) => !touched)) {
        retrying = true;
        left = RETRY_SECONDS;
        setTouchRetry(true);
        setTouchLeft(left);
        return;
      }
      window.clearInterval(timer);
      finishTouch(false);
    }, 1000);
  });

  /** Plein écran réel (Android : barre d'adresse et boutons système masqués) puis affichage de la grille. */
  const startTouchGrid = async () => {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' } as FullscreenOptions);
      await (screen.orientation as any)?.lock?.('portrait').catch(() => undefined);
    } catch { /* iPhone : plein écran indisponible, la grille couvre la zone visible */ }
    setTouchIntro(false);
  };

  const markTouch = (clientX: number, clientY: number) => {
    if (touchIntro) return;
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const index = Number(target?.dataset?.cell);
    touchStartedRef.current = true;
    if (Number.isNaN(index) || cellsRef.current[index]) return;
    cellsRef.current[index] = true;
    setTouchCells([...cellsRef.current]);
    if (cellsRef.current.every(Boolean)) window.setTimeout(() => finishTouch(false), 250);
  };

  const run = async () => {
    setRunning(true);
    setReport(null);
    setSendError('');
    setPartial([]);
    const started = performance.now();
    const tests: FunctionalTest[] = [];
    const add = (results: FunctionalTest | FunctionalTest[]) => {
      tests.push(...(Array.isArray(results) ? results : [results]));
      setPartial([...tests]);
    };
    // Capteurs en premier : sur iPhone l'autorisation doit être demandée directement après le toucher.
    setStep('Capteurs de mouvement et vibreur…');
    add(await testMotionAndVibration());
    setStep('Batterie, réseau, multi-touch…');
    add(await testBatteryAndNetwork());
    setStep('Appareil photo arrière…');
    add(await testCamera('environment'));
    setStep('Appareil photo avant…');
    add(await testCamera('user'));
    setStep('Micro et haut-parleur (un bip va retentir)…');
    add(await testAudioLoopback());
    setStep('Écran tactile : glissez le doigt sur toutes les cases');
    add(await runTouchTest());

    const finalReport: FunctionalTestReport = { ranAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), tests };
    setReport(finalReport);
    setStep('');
    setRunning(false);
    try {
      const response = await fetch(`/api/insurance-sessions/${sessionToken}/functional-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeCode, report: finalReport }),
      });
      if (!response.ok) setSendError((await response.json().catch(() => ({}))).message || 'Résultats non transmis.');
    } catch {
      setSendError('Résultats non transmis : vérifiez la connexion.');
    }
  };

  return (
    <div className="space-y-3 text-left">
      {touchCells && touchIntro && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-white">
          <p className="text-lg font-black">Test de l’écran tactile</p>
          <p className="text-sm text-slate-300">L’écran passe en plein écran. Glissez le doigt sur toutes les cases, des bords du haut jusqu’en bas : chacune devient verte.</p>
          <button onClick={startTouchGrid} className="w-full max-w-xs rounded-xl bg-blue-600 py-4 text-base font-bold">Commencer</button>
          <button onClick={() => finishTouch(true)} className="text-xs text-slate-400 underline">Passer ce test</button>
        </div>
      )}
      {touchCells && !touchIntro && (
        <div className="fixed inset-0 z-[60] bg-slate-900 touch-none select-none"
          onTouchStart={(e) => Array.from(e.touches).forEach((t) => markTouch(t.clientX, t.clientY))}
          onTouchMove={(e) => Array.from(e.touches).forEach((t) => markTouch(t.clientX, t.clientY))}
          onPointerDown={(e) => markTouch(e.clientX, e.clientY)}
          onPointerMove={(e) => e.buttons && markTouch(e.clientX, e.clientY)}>
          <div className="grid h-full w-full gap-[2px] p-[2px]" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
            {touchCells.map((touched, index) => (
              <div key={index} data-cell={index}
                className={`rounded-sm ${touched ? 'bg-emerald-500' : touchRetry ? 'animate-pulse bg-red-500' : 'bg-slate-700'}`} />
            ))}
          </div>
          {/* Consigne flottante au centre : aucune bande ne masque le haut ou le bas de l'écran. */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
            <div className="flex items-center gap-3 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg">
            <span>
              {touchRetry
                ? `Touchez les ${touchCells.filter((touched) => !touched).length} case(s) en rouge · ${touchLeft} s`
                : `Glissez le doigt sur toutes les cases (${touchCells.filter(Boolean).length}/${touchCells.length})${touchStartedRef.current ? ` · ${touchLeft} s` : ''}`}
            </span>
            <button onClick={() => finishTouch(true)} className="pointer-events-auto shrink-0 rounded-full bg-white/20 px-3 py-1 font-semibold">Passer</button>
            </div>
          </div>
        </div>
      )}

      {!running && !report && (
        <button onClick={run} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-4 text-base font-bold text-white shadow-lg shadow-blue-500/30">
          <Stethoscope className="h-5 w-5" />Lancer le diagnostic
        </button>
      )}
      {!running && !report && (
        <p className="text-center text-[11px] text-slate-500">Environ 40 secondes : caméras, micro, haut-parleur, capteurs, vibreur, écran tactile. Autorisez la caméra et le micro quand le téléphone le demande.</p>
      )}

      {running && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          <p className="flex items-center gap-2 font-semibold"><RefreshCw className="h-4 w-4 animate-spin" />{step}</p>
          {partial.length > 0 && <p className="mt-1 text-blue-700">{partial.filter((t) => t.status === 'pass').length} test(s) réussi(s) sur {partial.length}</p>}
        </div>
      )}

      {report && <FunctionalTestsCard report={report} />}
      {report && !sendError && <p className="text-center text-xs font-semibold text-emerald-700">Résultats envoyés : ils s’affichent sur l’ordinateur.</p>}
      {sendError && <p role="alert" className="text-center text-xs text-red-700">{sendError}</p>}
      {report && <button onClick={run} className="w-full text-xs font-semibold text-slate-500 underline">Relancer le diagnostic</button>}
    </div>
  );
};
