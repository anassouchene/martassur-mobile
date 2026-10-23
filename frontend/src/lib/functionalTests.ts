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

/**
 * Ouvre une caméra, lit deux images et vérifie qu'elles contiennent un vrai signal (non noir, non figé).
 * Caméra arrière : le flash est ensuite allumé et l'image doit s'éclairer.
 */
export async function testCamera(facing: 'environment' | 'user'): Promise<FunctionalTest[]> {
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
    const brightness = (gray: number[]) => gray.reduce((a, b) => a + b, 0) / gray.length;
    const first = frame();
    await wait(400);
    const second = frame();
    if (!video.videoWidth) return [{ id, label, status: 'fail', detail: 'aucune image reçue' }];
    const size = `${video.videoWidth}×${video.videoHeight}`;
    const mean = brightness(second);
    const spread = Math.sqrt(second.reduce((a, b) => a + (b - mean) ** 2, 0) / second.length);
    const motion = second.reduce((a, b, i) => a + Math.abs(b - first[i]), 0) / second.length;
    let camera: FunctionalTest = mean < 8 && spread < 4
      ? { id, label, status: 'warn', detail: `image noire (${size}) : objectif masqué ou capteur défaillant` }
      : { id, label, status: 'pass', detail: `${size}, image nette${motion > 0.5 ? ' et vivante' : ''}` };
    if (facing === 'user') return [camera];

    const track = stream.getVideoTracks()[0] as any;
    if (!track?.getCapabilities?.().torch) {
      return [camera, { id: 'flash', label: 'Flash', status: 'unsupported', detail: 'non pilotable depuis ce navigateur (iPhone) ou absent' }];
    }
    try {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      await wait(900);
      const gain = brightness(frame()) - mean;
      await track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => undefined);
      if (gain < 10) return [camera, { id: 'flash', label: 'Flash', status: 'warn', detail: 'allumé mais aucun éclairage mesuré : posez le téléphone écran vers le haut et relancez' }];
      // Objectif posé contre la table : image noire, mais si le flash l'éclaire, le capteur fonctionne.
      if (camera.status === 'warn') camera = { id, label, status: 'pass', detail: `${size}, image confirmée avec le flash` };
      return [camera, { id: 'flash', label: 'Flash', status: 'pass', detail: `éclairage mesuré par la caméra (+${Math.round(gain)})` }];
    } catch {
      return [camera, { id: 'flash', label: 'Flash', status: 'warn', detail: 'erreur pendant le test' }];
    }
  } catch (error) {
    const failure = openFailure(id, label, error);
    return facing === 'user' ? [failure] : [failure, { id: 'flash', label: 'Flash', status: 'unsupported', detail: 'non vérifiable sans caméra arrière' }];
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/** Caméras déclarées par le téléphone (leurs noms ne sont visibles qu'après l'autorisation caméra). */
export async function testCameraCount(): Promise<FunctionalTest> {
  const id = 'cameras';
  const label = 'Caméras détectées';
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    if (!cameras.length || cameras.every((camera) => !camera.label)) return { id, label, status: 'unsupported', detail: 'liste masquée sans autorisation caméra' };
    const back = cameras.filter((camera) => /back|rear|environment|arrière/i.test(camera.label)).length;
    const front = cameras.filter((camera) => /front|user|avant/i.test(camera.label)).length;
    return { id, label, status: 'pass', detail: back + front === cameras.length ? `${cameras.length} : ${back} arrière, ${front} avant` : `${cameras.length} caméra(s)` };
  } catch {
    return { id, label, status: 'unsupported', detail: 'liste non lisible' };
  }
}

// Balayage du haut-parleur, des graves aux aigus : un son étouffé trahit un haut-parleur abîmé ou obstrué.
const SWEEP_HZ = [700, 2000, 4000, 8000];

/**
 * Le haut-parleur joue un son de 1 kHz que le micro doit capter : vérifie les deux à la fois.
 * Puis quatre fréquences de 700 Hz à 8 kHz : qualité du son restitué.
 */
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
    const binWidth = audio.sampleRate / analyser.fftSize;
    // getFloatFrequencyData renvoie -Infinity pour un silence numérique parfait : on borne au plancher de l'analyseur.
    const floor = analyser.minDecibels;
    const clamp = (value: number) => (Number.isFinite(value) ? Math.max(value, floor) : floor);
    /** Niveau maximal capté à chaque fréquence demandée, bruit de fond moyen et présence d'un signal. */
    const measure = async (ms: number, tones: number[]) => {
      const peaks = tones.map(() => floor);
      let noiseSum = 0;
      let samples = 0;
      let signal = false;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        analyser.getFloatFrequencyData(bins);
        tones.forEach((hz, k) => {
          const bin = Math.round(hz / binWidth);
          peaks[k] = Math.max(peaks[k], clamp(bins[bin - 1]), clamp(bins[bin]), clamp(bins[bin + 1]));
        });
        let rowSum = 0;
        for (let i = 5; i < 200; i += 1) {
          if (Number.isFinite(bins[i]) && bins[i] > floor) signal = true;
          rowSum += clamp(bins[i]);
        }
        noiseSum += rowSum / 195;
        samples += 1;
        await wait(50);
      }
      return { peaks, noise: noiseSum / Math.max(samples, 1), signal };
    };
    const play = async (hz: number, ms: number) => {
      const oscillator = audio!.createOscillator();
      const gain = audio!.createGain();
      oscillator.frequency.value = hz;
      gain.gain.value = 0.6;
      oscillator.connect(gain).connect(audio!.destination);
      oscillator.start();
      const result = await measure(ms, [hz]);
      oscillator.stop();
      return result;
    };
    const silence = await measure(400, [1000, ...SWEEP_HZ]);
    const playing = await play(1000, 900);
    const heard = playing.peaks[0] - silence.peaks[0];
    const toneHeard = heard >= 12;
    // Si le son de test est capté, le micro fonctionne forcément.
    const micWorks = silence.signal || playing.signal || toneHeard;
    let range: FunctionalTest = { id: 'speaker_range', label: 'Qualité du son', status: 'unsupported', detail: 'non vérifiable sans son de test capté' };
    if (toneHeard) {
      let restored = 0;
      for (let k = 0; k < SWEEP_HZ.length; k += 1) {
        if ((await play(SWEEP_HZ[k], 350)).peaks[0] - silence.peaks[k + 1] >= 10) restored += 1;
      }
      range = restored >= 3
        ? { id: 'speaker_range', label: 'Qualité du son', status: 'pass', detail: `${restored}/${SWEEP_HZ.length} fréquences restituées (700 Hz à 8 kHz)` }
        : { id: 'speaker_range', label: 'Qualité du son', status: 'warn', detail: `son étouffé : ${restored}/${SWEEP_HZ.length} fréquences restituées (haut-parleur abîmé ou obstrué ?)` };
    }
    return [
      micWorks
        ? { id: 'microphone', label: 'Micro', status: 'pass', detail: toneHeard ? 'capte le son de test' : `signal capté (bruit de fond ${Math.round(silence.noise)} dB)` }
        : { id: 'microphone', label: 'Micro', status: 'fail', detail: 'aucun son capté (micro muet ou obstrué)' },
      toneHeard
        ? { id: 'speaker', label: 'Haut-parleur', status: 'pass', detail: `son de test entendu par le micro (+${Math.min(Math.round(heard), 60)} dB)` }
        : { id: 'speaker', label: 'Haut-parleur', status: micWorks ? 'warn' : 'unsupported', detail: micWorks ? 'son de test non capté : volume au maximum et mode silencieux désactivé ?' : 'non vérifiable sans micro' },
      range,
    ];
  } catch (error) {
    return [
      openFailure('microphone', 'Micro', error),
      { id: 'speaker', label: 'Haut-parleur', status: 'unsupported', detail: 'non vérifiable sans micro' },
      { id: 'speaker_range', label: 'Qualité du son', status: 'unsupported', detail: 'non vérifiable sans micro' },
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

/** Boussole (magnétomètre) : lit le cap magnétique pendant 1,2 s. */
export async function testCompass(): Promise<FunctionalTest> {
  const id = 'compass';
  const label = 'Boussole';
  const Orientation = (window as any).DeviceOrientationEvent;
  if (!Orientation) return { id, label, status: 'unsupported', detail: 'non disponible dans ce navigateur' };
  try {
    // iPhone : même autorisation « mouvement et orientation » que l'accéléromètre, demandée juste avant.
    if (typeof Orientation.requestPermission === 'function' && (await Orientation.requestPermission()) !== 'granted') {
      return { id, label, status: 'skipped', detail: 'autorisation refusée : non testé' };
    }
  } catch {
    return { id, label, status: 'skipped', detail: 'autorisation refusée : non testé' };
  }
  const headings: number[] = [];
  const handler = (event: any) => {
    if (typeof event.webkitCompassHeading === 'number') headings.push(event.webkitCompassHeading);
    else if (event.absolute && event.alpha != null) headings.push((360 - event.alpha) % 360);
  };
  window.addEventListener('deviceorientationabsolute', handler);
  window.addEventListener('deviceorientation', handler);
  await wait(1200);
  window.removeEventListener('deviceorientationabsolute', handler);
  window.removeEventListener('deviceorientation', handler);
  return headings.length >= 3
    ? { id, label, status: 'pass', detail: `cap magnétique mesuré (${Math.round(headings[headings.length - 1])}°)` }
    : { id, label, status: 'unsupported', detail: 'non mesurée (pas de magnétomètre, ou non exposé par le navigateur)' };
}

/**
 * NFC (Android) : démarrer une lecture prouve que la puce est présente et activée ; la lecture est coupée aussitôt.
 * À lancer juste après le toucher du client : la demande d'autorisation l'exige.
 */
export async function testNfc(): Promise<FunctionalTest> {
  const id = 'nfc';
  const label = 'NFC';
  const Reader = (window as any).NDEFReader;
  if (!Reader) return { id, label, status: 'unsupported', detail: 'non pilotable depuis ce navigateur (iPhone)' };
  const controller = new AbortController();
  try {
    const answered = await Promise.race([
      new Reader().scan({ signal: controller.signal }).then(() => true),
      wait(15000).then(() => false),
    ]);
    return answered
      ? { id, label, status: 'pass', detail: 'puce NFC active' }
      : { id, label, status: 'skipped', detail: 'autorisation sans réponse : non testé' };
  } catch (error: any) {
    if (error?.name === 'NotAllowedError') return { id, label, status: 'skipped', detail: 'autorisation refusée : non testé' };
    if (error?.name === 'NotSupportedError') return { id, label, status: 'unsupported', detail: 'pas de puce NFC sur ce téléphone' };
    if (error?.name === 'NotReadableError') return { id, label, status: 'warn', detail: 'NFC désactivé dans les réglages ?' };
    return { id, label, status: 'warn', detail: 'erreur pendant le test' };
  } finally {
    controller.abort();
  }
}

/** Bluetooth : le navigateur indique si un adaptateur est disponible, sans rien appairer. */
export async function testBluetooth(): Promise<FunctionalTest> {
  const id = 'bluetooth';
  const label = 'Bluetooth';
  const bluetooth = (navigator as any).bluetooth;
  if (!bluetooth?.getAvailability) return { id, label, status: 'unsupported', detail: 'non lisible depuis ce navigateur (iPhone)' };
  try {
    return (await bluetooth.getAvailability())
      ? { id, label, status: 'pass', detail: 'adaptateur détecté' }
      : { id, label, status: 'warn', detail: 'adaptateur non détecté (Bluetooth désactivé ?)' };
  } catch {
    return { id, label, status: 'unsupported', detail: 'non lisible' };
  }
}

/** Affichage : définition réelle de l'écran et fréquence de rafraîchissement mesurée (images par seconde). */
export async function testDisplay(): Promise<FunctionalTest> {
  const id = 'display';
  const label = 'Affichage';
  if (document.hidden) return { id, label, status: 'unsupported', detail: 'non mesuré (page en arrière-plan)' };
  const fps = await new Promise<number>((resolve) => {
    let frames = 0;
    let start = 0;
    let done = false;
    const finish = (now: number) => {
      if (done) return;
      done = true;
      resolve(start && now > start ? (frames * 1000) / (now - start) : 0);
    };
    const tick = (now: number) => {
      if (done) return;
      if (!start) start = now;
      else frames += 1;
      if (now - start >= 1000) return finish(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Le navigateur peut suspendre l'affichage (page masquée) : on conclut quand même.
    window.setTimeout(() => finish(performance.now()), 2000);
  });
  const size = `${Math.round(screen.width * devicePixelRatio)}×${Math.round(screen.height * devicePixelRatio)} px`;
  // Arrondi à la fréquence standard la plus proche ; en dessous, mode économie d'énergie probable (iPhone : 30 images/s).
  const hz = [60, 90, 120, 144].reduce((best, rate) => (Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best));
  const extras = [matchMedia('(dynamic-range: high)').matches && 'HDR', matchMedia('(color-gamut: p3)').matches && 'couleurs P3'].filter(Boolean);
  const rate = fps >= 45 ? `${hz} Hz` : `${Math.round(fps)} images/s (économie d’énergie ?)`;
  return { id, label, status: 'pass', detail: [size, rate, ...extras].join(', ') };
}

/** Verrouillage de l'écran (code, empreinte ou visage) : utile contre le vol, lu sans rien enregistrer. */
export async function testScreenLock(): Promise<FunctionalTest> {
  const id = 'screen_lock';
  const label = 'Verrouillage sécurisé';
  const Credential = (window as any).PublicKeyCredential;
  if (!Credential?.isUserVerifyingPlatformAuthenticatorAvailable) return { id, label, status: 'unsupported', detail: 'non lisible depuis ce navigateur' };
  try {
    return (await Credential.isUserVerifyingPlatformAuthenticatorAvailable())
      ? { id, label, status: 'pass', detail: 'code, empreinte ou visage configuré' }
      : { id, label, status: 'warn', detail: 'aucun verrouillage détecté (code, empreinte ou visage)' };
  } catch {
    return { id, label, status: 'unsupported', detail: 'non lisible' };
  }
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
