// Tests de fonctionnement exécutés sur le téléphone lui-même (page /verify, après le scan du QR code).
// Chaque test mesure un signal réel ; s'il ne peut pas conclure, il le dit (« non vérifiable »), sans inventer.

export type TestStatus = 'pass' | 'fail' | 'warn' | 'unsupported' | 'skipped';

export interface FunctionalTest {
  id: string;
  label: string;
  status: TestStatus;
  detail: string;
}

export interface FunctionalTestReport {
  ranAt: string;
  durationMs: number;
  tests: FunctionalTest[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Échec d'ouverture : autorisation refusée = non testé (pas une panne) ; matériel introuvable = défaillant. */
const openFailure = (id: string, label: string, error: any): FunctionalTest =>
  error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
    ? { id, label, status: 'skipped', detail: 'autorisation refusée : non testé' }
    : error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
    ? { id, label, status: 'fail', detail: 'absent ou inaccessible' }
    : { id, label, status: 'warn', detail: 'erreur pendant le test' };

/** Ouvre une caméra, lit deux images et vérifie qu'elles contiennent un vrai signal (non noir, non figé). */
export async function testCamera(facing: 'environment' | 'user'): Promise<FunctionalTest> {
  const id = facing === 'environment' ? 'camera_back' : 'camera_front';
  const label = facing === 'environment' ? 'Appareil photo arrière' : 'Appareil photo avant';
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing }, width: { ideal: 640 } }, audio: false })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }));
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await wait(700);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const frame = () => {
      context.drawImage(video, 0, 0, 64, 48);
      const data = context.getImageData(0, 0, 64, 48).data;
      const gray: number[] = [];
      for (let i = 0; i < data.length; i += 4) gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      return gray;
    };
    const first = frame();
    await wait(400);
    const second = frame();
    if (!video.videoWidth) return { id, label, status: 'fail', detail: 'aucune image reçue' };
    const mean = second.reduce((a, b) => a + b, 0) / second.length;
    const spread = Math.sqrt(second.reduce((a, b) => a + (b - mean) ** 2, 0) / second.length);
    const motion = second.reduce((a, b, i) => a + Math.abs(b - first[i]), 0) / second.length;
    if (mean < 8 && spread < 4) return { id, label, status: 'warn', detail: `image noire (${video.videoWidth}×${video.videoHeight}) : objectif masqué ou capteur défaillant` };
    return { id, label, status: 'pass', detail: `${video.videoWidth}×${video.videoHeight}, image nette${motion > 0.5 ? ' et vivante' : ''}` };
  } catch (error) {
    return openFailure(id, label, error);
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/** Le haut-parleur joue un son de 1 kHz que le micro doit capter : vérifie les deux à la fois. */
export async function testAudioLoopback(): Promise<FunctionalTest[]> {
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    audio = new AudioCtx();
    await audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    audio.createMediaStreamSource(stream).connect(analyser);
    const bins = new Float32Array(analyser.frequencyBinCount);
    const toneBin = Math.round(1000 / (audio.sampleRate / analyser.fftSize));
    // getFloatFrequencyData renvoie -Infinity pour un silence numérique parfait : on borne au plancher de l'analyseur.
    const floor = analyser.minDecibels;
    const clamp = (value: number) => (Number.isFinite(value) ? Math.max(value, floor) : floor);
    const measure = async (ms: number) => {
      let tone = floor;
      let noiseSum = 0;
      let samples = 0;
      let signal = false;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        analyser.getFloatFrequencyData(bins);
        tone = Math.max(tone, clamp(bins[toneBin - 1]), clamp(bins[toneBin]), clamp(bins[toneBin + 1]));
        let rowSum = 0;
        for (let i = 5; i < 200; i += 1) {
          if (Number.isFinite(bins[i]) && bins[i] > floor) signal = true;
          rowSum += clamp(bins[i]);
        }
        noiseSum += rowSum / 195;
        samples += 1;
        await wait(50);
      }
      return { tone, noise: noiseSum / Math.max(samples, 1), signal };
    };
    const silence = await measure(400);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 1000;
    gain.gain.value = 0.6;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    const playing = await measure(900);
    oscillator.stop();
    const heard = playing.tone - silence.tone;
    const toneHeard = heard >= 12;
    // Si le son de test est capté, le micro fonctionne forcément.
    const micWorks = silence.signal || playing.signal || toneHeard;
    return [
      micWorks
        ? { id: 'microphone', label: 'Micro', status: 'pass', detail: toneHeard ? 'capte le son de test' : `signal capté (bruit de fond ${Math.round(silence.noise)} dB)` }
        : { id: 'microphone', label: 'Micro', status: 'fail', detail: 'aucun son capté (micro muet ou obstrué)' },
      toneHeard
        ? { id: 'speaker', label: 'Haut-parleur', status: 'pass', detail: `son de test entendu par le micro (+${Math.min(Math.round(heard), 60)} dB)` }
        : { id: 'speaker', label: 'Haut-parleur', status: micWorks ? 'warn' : 'unsupported', detail: micWorks ? 'son de test non capté : volume au maximum et mode silencieux désactivé ?' : 'non vérifiable sans micro' },
    ];
  } catch (error) {
    return [
      openFailure('microphone', 'Micro', error),
      { id: 'speaker', label: 'Haut-parleur', status: 'unsupported', detail: 'non vérifiable sans micro' },
    ];
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await audio?.close().catch(() => undefined);
  }
}

/**
 * Accéléromètre / gyroscope : lit les événements de mouvement pendant 1,5 s.
 * Vibration (Android) : la vibration est mesurée par l'accéléromètre, pas seulement « commandée ».
 */
export async function testMotionAndVibration(): Promise<FunctionalTest[]> {
  const Motion = (window as any).DeviceMotionEvent;
  if (!Motion) return [{ id: 'motion', label: 'Capteurs de mouvement', status: 'unsupported', detail: 'non disponibles dans ce navigateur' }];
  try {
    if (typeof Motion.requestPermission === 'function' && (await Motion.requestPermission()) !== 'granted') {
      return [{ id: 'motion', label: 'Capteurs de mouvement', status: 'skipped', detail: 'autorisation refusée : non testé' }];
    }
  } catch {
    return [{ id: 'motion', label: 'Capteurs de mouvement', status: 'skipped', detail: 'autorisation refusée : non testé' }];
  }
  const samples: { g: number; a: number; gyro: boolean; t: number }[] = [];
  const handler = (event: DeviceMotionEvent) => {
    const g = event.accelerationIncludingGravity;
    const a = event.acceleration;
    if (g?.x == null) return;
    samples.push({
      g: Math.hypot(g.x ?? 0, g.y ?? 0, g.z ?? 0),
      a: Math.hypot(a?.x ?? 0, a?.y ?? 0, a?.z ?? 0),
      gyro: event.rotationRate?.alpha != null,
      t: performance.now(),
    });
  };
  window.addEventListener('devicemotion', handler);
  await wait(1500);
  const vibrationStart = performance.now();
  const canVibrate = typeof navigator.vibrate === 'function' && navigator.vibrate([500, 120, 500]);
  await wait(1300);
  window.removeEventListener('devicemotion', handler);

  // Aucune mesure : capteur absent OU navigateur qui ne les expose pas — impossible de trancher, donc « à vérifier ».
  if (samples.length < 5) return [{ id: 'motion', label: 'Capteurs de mouvement', status: 'warn', detail: 'aucune mesure reçue (capteurs non exposés par le navigateur ?)' }];
  const gravity = samples.reduce((sum, s) => sum + s.g, 0) / samples.length;
  const results: FunctionalTest[] = [
    gravity > 7 && gravity < 13
      ? { id: 'accelerometer', label: 'Accéléromètre', status: 'pass', detail: `gravité mesurée ${gravity.toFixed(1)} m/s²` }
      : { id: 'accelerometer', label: 'Accéléromètre', status: 'fail', detail: `mesure incohérente (${gravity.toFixed(1)} m/s²)` },
    samples.some((s) => s.gyro)
      ? { id: 'gyroscope', label: 'Gyroscope', status: 'pass', detail: 'rotation mesurée' }
      : { id: 'gyroscope', label: 'Gyroscope', status: 'unsupported', detail: 'non exposé par le navigateur' },
  ];
  if (!canVibrate) {
    results.push({ id: 'vibration', label: 'Vibreur', status: 'unsupported', detail: 'non pilotable depuis ce navigateur (iPhone)' });
  } else {
    const energy = (from: number, to: number) => {
      const window = samples.filter((s) => s.t >= from && s.t < to);
      return window.length ? window.reduce((sum, s) => sum + s.a, 0) / window.length : 0;
    };
    const before = energy(vibrationStart - 1200, vibrationStart);
    const during = energy(vibrationStart + 50, vibrationStart + 1150);
    results.push(during > before * 1.8 && during - before > 0.08
      ? { id: 'vibration', label: 'Vibreur', status: 'pass', detail: 'vibration mesurée par l’accéléromètre' }
      : { id: 'vibration', label: 'Vibreur', status: 'warn', detail: 'vibration non mesurée (mode silencieux, téléphone sur un support souple ?)' });
  }
  return results;
}

export async function testBatteryAndNetwork(): Promise<FunctionalTest[]> {
  const nav = navigator as any;
  const results: FunctionalTest[] = [];
  try {
    const battery = await nav.getBattery?.();
    results.push(battery
      ? { id: 'battery', label: 'Batterie', status: 'pass', detail: `${Math.round(battery.level * 100)} %${battery.charging ? ', en charge' : ''}` }
      : { id: 'battery', label: 'Batterie', status: 'unsupported', detail: 'non lisible sur ce navigateur (iPhone)' });
  } catch {
    results.push({ id: 'battery', label: 'Batterie', status: 'unsupported', detail: 'non lisible' });
  }
  const connection = nav.connection;
  results.push({
    id: 'network', label: 'Réseau', status: navigator.onLine ? 'pass' : 'fail',
    detail: navigator.onLine ? `connecté${connection?.effectiveType ? ` (${connection.effectiveType.toUpperCase()}${connection.type ? `, ${connection.type}` : ''})` : ''}` : 'hors ligne',
  });
  results.push(navigator.maxTouchPoints > 1
    ? { id: 'multitouch', label: 'Multi-touch', status: 'pass', detail: `${navigator.maxTouchPoints} points de contact` }
    : { id: 'multitouch', label: 'Multi-touch', status: navigator.maxTouchPoints === 1 ? 'warn' : 'unsupported', detail: navigator.maxTouchPoints === 1 ? 'un seul point de contact' : 'non exposé' });
  return results;
}

export const touchTestResult = (cells: boolean[], columns: number, skipped: boolean): FunctionalTest => {
  if (skipped) return { id: 'touchscreen', label: 'Écran tactile', status: 'skipped', detail: 'test passé par le client' };
  const missing = cells.map((touched, index) => (touched ? null : index)).filter((index): index is number => index !== null);
  if (!missing.length) return { id: 'touchscreen', label: 'Écran tactile', status: 'pass', detail: `${cells.length}/${cells.length} zones réactives` };
  const zones = missing.map((index) => `ligne ${Math.floor(index / columns) + 1} col. ${(index % columns) + 1}`);
  return { id: 'touchscreen', label: 'Écran tactile', status: 'fail', detail: `${missing.length} zone(s) sans réaction : ${zones.slice(0, 4).join(', ')}${zones.length > 4 ? '…' : ''}` };
};
