'use client';

import React, { useRef, useState } from 'react';
import { BatteryCharging, Hand, RefreshCw, RotateCw, Stethoscope } from 'lucide-react';
import { FunctionalTestsCard } from '@/components/FunctionalTestsCard';
import {
  FunctionalTest, FunctionalTestReport, TestStatus, testAudioLoopback, testBatteryAndNetwork, testBluetooth, testCamera, testCameraCount,
  testCompass, testDisplay, testMotionAndVibration, testNfc, testScreenLock, touchTestResult,
} from '@/lib/functionalTests';

const COLUMNS = 4;
const ROWS = 7;
const TOUCH_SECONDS = 20;
const RETRY_SECONDS = 10;
const CHARGE_SECONDS = 20;
const ACTION_SECONDS = 15;
// Blanc, noir, rouge, vert, bleu, gris : chaque fond révèle un défaut différent (pixel mort, tache, marquage).
const SCREEN_COLORS = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#808080'];

interface ActionPrompt {
  title: string;
  text: string;
  icon: React.ReactNode;
  left: number;
}

interface ActionTest {
  id: string;
  label: string;
  title: string;
  text: string;
  icon: React.ReactNode;
  seconds: number;
  success: string;
  timeout: string;
  /** Surveille l'action du client, appelle `done` quand elle est constatée, et renvoie le nettoyage. */
  watch: (done: () => void) => () => void;
}

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
  // Écran « action demandée » (brancher le chargeur, tourner le téléphone, poser deux doigts) ; null = masqué.
  const [prompt, setPrompt] = useState<ActionPrompt | null>(null);
  const promptSkipRef = useRef<(() => void) | null>(null);
  // Couleurs de l'écran : introduction, index de la couleur affichée, puis question au client.
  const [colorStep, setColorStep] = useState<'intro' | 'question' | number | null>(null);
  const colorResolveRef = useRef<((result: FunctionalTest) => void) | null>(null);

  /** Demande une action au client : réussi dès qu'elle est constatée, « à vérifier » si le délai expire. */
  const askAction = (test: ActionTest) => new Promise<FunctionalTest>((resolve) => {
    let left = test.seconds;
    let finished = false;
    let stop: () => void = () => undefined;
    const finish = (status: TestStatus, detail: string) => {
      if (finished) return;
      finished = true;
      window.clearInterval(timer);
      stop();
      promptSkipRef.current = null;
      setPrompt(null);
      resolve({ id: test.id, label: test.label, status, detail });
    };
    const timer = window.setInterval(() => {
      left -= 1;
      setPrompt((current) => current && { ...current, left });
      if (left <= 0) finish('warn', test.timeout);
    }, 1000);
    promptSkipRef.current = () => finish('skipped', 'test passé par le client');
    setPrompt({ title: test.title, text: test.text, icon: test.icon, left });
    stop = test.watch(() => finish('pass', test.success));
    if (finished) stop();
  });

  /** Port de charge : le client branche son chargeur, le navigateur doit voir la charge démarrer. */
  const runChargeTest = async (): Promise<FunctionalTest> => {
    const id = 'charging_port';
    const label = 'Port de charge';
    const battery = await Promise.resolve((navigator as any).getBattery?.()).catch(() => null);
    if (!battery) return { id, label, status: 'unsupported', detail: 'non lisible sur ce navigateur (iPhone)' };
    if (battery.charging) return { id, label, status: 'pass', detail: 'en charge : le port fonctionne' };
    return askAction({
      id, label, seconds: CHARGE_SECONDS,
      title: 'Test du port de charge',
      text: 'Branchez le chargeur sur le téléphone : le test réussit dès que la charge démarre.',
      icon: <BatteryCharging className="h-12 w-12 text-emerald-400" />,
      success: 'branchement détecté : le port fonctionne',
      timeout: `aucune charge détectée en ${CHARGE_SECONDS} s (câble, chargeur ou port à vérifier)`,
      watch: (done) => {
        const onChange = () => battery.charging && done();
        battery.addEventListener('chargingchange', onChange);
        return () => battery.removeEventListener('chargingchange', onChange);
      },
    });
  };

  /** Rotation : le client tourne le téléphone, l'affichage doit passer en paysage (capteurs + système). */
  const runRotationTest = () => {
    (screen.orientation as any)?.unlock?.();
    const landscape = () => window.innerWidth > window.innerHeight;
    const initial = landscape();
    return askAction({
      id: 'auto_rotate', label: 'Rotation de l’écran', seconds: ACTION_SECONDS,
      title: 'Test de la rotation',
      text: 'Prenez le téléphone en main et tournez-le à l’horizontale : l’écran doit pivoter.',
      icon: <RotateCw className="h-12 w-12 text-sky-400" />,
      success: 'l’écran a pivoté',
      timeout: `l’écran n’a pas pivoté en ${ACTION_SECONDS} s (rotation automatique désactivée ?)`,
      watch: (done) => {
        const onChange = () => landscape() !== initial && done();
        window.addEventListener('resize', onChange);
        window.addEventListener('orientationchange', onChange);
        return () => {
          window.removeEventListener('resize', onChange);
          window.removeEventListener('orientationchange', onChange);
        };
      },
    });
  };

  /** Multi-touch réel : deux doigts posés en même temps (remplace la valeur simplement déclarée par le système). */
  const runTwoFingerTest = () => askAction({
    id: 'multitouch', label: 'Multi-touch', seconds: ACTION_SECONDS,
    title: 'Test du multi-touch',
    text: 'Posez deux doigts sur l’écran en même temps.',
    icon: <Hand className="h-12 w-12 text-amber-300" />,
    success: `deux doigts détectés en même temps (${navigator.maxTouchPoints} points max.)`,
    timeout: `aucun appui à deux doigts détecté en ${ACTION_SECONDS} s`,
    watch: (done) => {
      const onTouch = (event: TouchEvent) => event.touches.length >= 2 && done();
      window.addEventListener('touchstart', onTouch);
      return () => window.removeEventListener('touchstart', onTouch);
    },
  });

  /** Couleurs unies plein écran : le client signale points morts, taches ou lignes (réponse déclarative). */
  const runColorTest = () => new Promise<FunctionalTest>((resolve) => {
    colorResolveRef.current = resolve;
    setColorStep('intro');
  });

  const finishColors = (status: TestStatus, detail: string) => {
    const resolve = colorResolveRef.current;
    colorResolveRef.current = null;
    setColorStep(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    resolve?.({ id: 'screen_colors', label: 'Couleurs de l’écran', status, detail });
  };

  const startColors = async () => {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' } as FullscreenOptions);
    } catch { /* iPhone : plein écran indisponible, les couleurs couvrent la zone visible */ }
    setColorStep(0);
  };

  const nextColor = () => setColorStep((current) => (typeof current === 'number' && current < SCREEN_COLORS.length - 1 ? current + 1 : 'question'));

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
    // Un test réel remplace la valeur déclarée du même nom (multi-touch), sauf s'il a été passé.
    const replace = (result: FunctionalTest) => {
      const index = tests.findIndex((test) => test.id === result.id);
      if (index < 0) return add(result);
      if (result.status !== 'skipped') tests[index] = result;
      setPartial([...tests]);
    };
    // NFC puis capteurs en premier : leur autorisation doit être demandée directement après le toucher
    // (NFC sur Android, capteurs sur iPhone ; chacun répond aussitôt « non vérifiable » sur l'autre).
    setStep('NFC (autorisez si le téléphone le demande)…');
    add(await testNfc());
    setStep('Capteurs de mouvement et vibreur…');
    add(await testMotionAndVibration());
    setStep('Boussole…');
    add(await testCompass());
    setStep('Batterie, réseau, Bluetooth, verrouillage…');
    add(await testBatteryAndNetwork());
    add(await testBluetooth());
    add(await testScreenLock());
    setStep('Affichage…');
    add(await testDisplay());
    setStep('Appareil photo arrière et flash (posez le téléphone écran vers le haut)…');
    add(await testCamera('environment'));
    setStep('Appareil photo avant…');
    add(await testCamera('user'));
    add(await testCameraCount());
    setStep('Micro et haut-parleur (plusieurs bips vont retentir)…');
    add(await testAudioLoopback());
    setStep('Port de charge : branchez le chargeur');
    add(await runChargeTest());
    setStep('Rotation : tournez le téléphone à l’horizontale');
    add(await runRotationTest());
    setStep('Couleurs de l’écran');
    add(await runColorTest());
    setStep('Écran tactile : glissez le doigt sur toutes les cases');
    add(await runTouchTest());
    setStep('Multi-touch : posez deux doigts sur l’écran');
    replace(await runTwoFingerTest());

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
      {prompt && (
        // touch-none : deux doigts posés ne doivent pas zoomer la page pendant le test.
        <div className="fixed inset-0 z-[60] flex touch-none select-none flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-white">
          {prompt.icon}
          <p className="text-lg font-black">{prompt.title}</p>
          <p className="text-sm text-slate-300">{prompt.text}</p>
          <p className="text-3xl font-black tabular-nums">{prompt.left} s</p>
          <button onClick={() => promptSkipRef.current?.()} className="text-xs text-slate-400 underline">Passer ce test</button>
        </div>
      )}
      {colorStep === 'intro' && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-white">
          <p className="text-lg font-black">Test des couleurs de l’écran</p>
          <p className="text-sm text-slate-300">Tenez le téléphone à la verticale. L’écran va afficher {SCREEN_COLORS.length} couleurs unies : cherchez des points noirs ou figés, des taches ou des lignes. Touchez l’écran pour passer à la couleur suivante.</p>
          <button onClick={startColors} className="w-full max-w-xs rounded-xl bg-blue-600 py-4 text-base font-bold">Commencer</button>
          <button onClick={() => finishColors('skipped', 'test passé par le client')} className="text-xs text-slate-400 underline">Passer ce test</button>
        </div>
      )}
      {typeof colorStep === 'number' && (
        <div className="fixed inset-0 z-[60] cursor-pointer select-none" style={{ background: SCREEN_COLORS[colorStep] }} onClick={nextColor}>
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[10px] text-white mix-blend-difference">
            {colorStep + 1}/{SCREEN_COLORS.length} · touchez pour continuer
          </span>
        </div>
      )}
      {colorStep === 'question' && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-white">
          <p className="text-lg font-black">Avez-vous vu des points, des taches ou des lignes ?</p>
          <button onClick={() => finishColors('pass', `aucun défaut vu par le client sur ${SCREEN_COLORS.length} couleurs`)}
            className="w-full max-w-xs rounded-xl bg-emerald-600 py-4 text-base font-bold">Non, l’écran est parfait</button>
          <button onClick={() => finishColors('fail', 'défaut d’affichage signalé par le client (points, taches ou lignes)')}
            className="w-full max-w-xs rounded-xl bg-red-600 py-4 text-base font-bold">Oui, j’ai vu un défaut</button>
          <button onClick={() => finishColors('skipped', 'test passé par le client')} className="text-xs text-slate-400 underline">Passer ce test</button>
        </div>
      )}
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
        <p className="text-center text-[11px] text-slate-500">Environ 1 min 30 : caméras, flash, micro, haut-parleur, capteurs, boussole, vibreur, NFC, Bluetooth, écran, couleurs, rotation, port de charge, écran tactile. Gardez un chargeur à portée de main et autorisez la caméra, le micro et le NFC quand le téléphone le demande.</p>
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
