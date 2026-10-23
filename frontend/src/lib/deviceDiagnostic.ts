import { identifyApple } from '@/lib/appleModels';

// Diagnostic matériel en lecture seule : USB (WebADB) ou navigateur du téléphone (QR).
// Règle : une valeur non lue reste `null` — on n'invente jamais de chiffre.

export type DiagnosticSource = 'USB_ADB' | 'WEB_BROWSER';

export interface DeviceDiagnostic {
  source: DiagnosticSource;
  collectedAt: string;
  brand?: string | null;
  manufacturer?: string | null;
  model?: string | null;            // code modèle (ex. 2209116AG)
  marketName?: string | null;       // nom commercial si l'appareil le publie
  modelCandidates?: string[];       // Apple : modèles compatibles avec l'écran et la version d'iOS
  modelSource?: string | null;      // comment le modèle a été obtenu, si ce n'est pas l'appareil lui-même
  device?: string | null;           // nom de code (ex. sweet_k6a)
  androidVersion?: string | null;
  sdk?: number | null;
  securityPatch?: string | null;
  buildId?: string | null;
  soc?: string | null;
  cpuAbi?: string | null;
  cpuCores?: number | null;
  gpu?: string | null;
  ramGb?: number | null;            // capacité commerciale (arrondie au palier standard)
  ramRawGb?: number | null;         // valeur mesurée
  storageGb?: number | null;        // capacité commerciale
  storageRawGb?: number | null;
  storageSource?: string | null;
  dataUsedGb?: number | null;
  dataFreeGb?: number | null;
  screenResolution?: string | null;
  screenDensity?: number | null;
  battery?: {
    level?: number | null;
    charging?: boolean | null;
    health?: string | null;
    temperatureC?: number | null;
    voltageMv?: number | null;
    technology?: string | null;
    cycleCount?: number | null;
    capacityPercent?: number | null;
  } | null;
  verifiedBootState?: string | null;   // green = bootloader verrouillé
  bootloaderLocked?: boolean | null;
  imeiRead?: 'READ' | 'DENIED' | 'NOT_ATTEMPTED';
  imeiCount?: number;
  /** USB : composants déclarés par Android (pm list features) et état du système. */
  hardware?: {
    components: Record<string, boolean>;
    touchController?: boolean | null;
    simState?: string | null;
    rooted?: boolean | null;
    uptimeHours?: number | null;
    screenOn?: boolean | null;
  } | null;
  /** Navigateur en « Version pour ordinateur » : modèle et version Android masqués. */
  desktopMode?: boolean;
  warnings: string[];
}

const STANDARD_RAM_GB = [1, 2, 3, 4, 6, 8, 10, 12, 16, 18, 24, 32];
const STANDARD_STORAGE_GB = [8, 16, 32, 64, 128, 256, 512, 1024, 2048];
// Premier chiffre du TAC = organisme d'attribution GSMA ; exclut notamment un IMSI (604… au Maroc).
const IMEI_REPORTING_BODIES = new Set(['01', '10', '30', '33', '35', '44', '45', '49', '50', '51', '52', '53', '54', '86', '91', '98', '99']);

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Plus petit palier commercial supérieur ou égal à la mesure (la mesure est toujours < nominal). */
export const ceilToStandard = (raw: number, tiers: number[], tolerance = 0.03) =>
  tiers.find((tier) => tier >= raw * (1 - tolerance)) ?? null;

export const formatCapacity = (gb?: number | null) =>
  !gb ? '' : gb >= 1024 ? `${gb / 1024} To` : `${gb} Go`;

export const isValidImei = (value: string) => {
  if (!/^\d{15}$/.test(value)) return false;
  const sum = value.split('').reduce((total, character, index) => {
    let digit = Number(character);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    return total + digit;
  }, 0);
  return sum % 10 === 0;
};

const BATTERY_HEALTH: Record<string, string> = {
  '1': 'Inconnue', '2': 'Bonne', '3': 'Surchauffe', '4': 'Morte', '5': 'Surtension', '6': 'Défaillance', '7': 'Froid',
};

/** Extrait la chaîne d'un `service call` : `Result: Parcel(0x00000000: 00000000 0000000f 00360038 '........8.6.')`. */
export const parseParcelString = (output: string): string | null => {
  const firstWord = output.match(/0x00000000:\s+([0-9a-f]{8})/i)?.[1];
  if (firstWord !== '00000000') return null; // code d'exception non nul : permission refusée
  const text = Array.from(output.matchAll(/'([^']*)'/g)).map((match) => match[1]).join('').replace(/[.\s]/g, '');
  return text.match(/\d{15}/)?.[0] ?? null;
};

export const parseGetprop = (output: string) => {
  const props: Record<string, string> = {};
  for (const match of Array.from(output.matchAll(/^\[([^\]]+)\]: \[(.*)\]\s*$/gm))) props[match[1]] = match[2];
  return props;
};

/** `df -k` : capacité et usage de la ligne /data ; null si la sortie est illisible. */
export const parseDfData = (output: string) => {
  const rows = output.split('\n').map((line) => line.trim().split(/\s+/)).filter((cols) => cols.length >= 4 && /^\d+$/.test(cols[1]));
  const row = rows.find((cols) => cols[cols.length - 1] === '/data') ?? (rows.length === 1 ? rows[0] : undefined);
  if (!row) return null;
  return { totalKb: Number(row[1]), usedKb: Number(row[2]), freeKb: Number(row[3]) };
};

interface AdbLike {
  subprocess: {
    shellProtocol?: { spawnWaitText(command: string | readonly string[]): Promise<{ stdout: string }> };
    noneProtocol: { spawnWaitText(command: string | readonly string[]): Promise<string> };
  };
}

/**
 * Lit le diagnostic via ADB (lecture seule, commandes fixes, aucun fichier personnel).
 * Renvoie aussi les IMEI lus quand Android l'autorise au shell ADB ; ils ne sont jamais mis dans `diagnostic`.
 */
export async function readAdbDiagnostic(adb: AdbLike): Promise<{ diagnostic: DeviceDiagnostic; imeis: string[] }> {
  // Tableau à un élément : ADB le transmet tel quel à `sh -c`, sans re-découpage.
  const run = async (script: string) => {
    try {
      if (adb.subprocess.shellProtocol) return (await adb.subprocess.shellProtocol.spawnWaitText([script])).stdout;
      return await adb.subprocess.noneProtocol.spawnWaitText([script]);
    } catch {
      return '';
    }
  };
  const warnings: string[] = [];

  const [getpropOut, meminfoOut, blockOut, dfOut, batteryOut, batterySysOut, wmSizeOut, wmDensityOut, cpuOut, featuresOut, touchOut, suOut, uptimeOut, powerOut] = await Promise.all([
    run('getprop'),
    run('cat /proc/meminfo'),
    run('for b in /sys/block/sd? /sys/block/mmcblk? /sys/block/nvme?n?; do [ -r "$b/size" ] && echo "$b $(cat $b/size) $(cat $b/removable 2>/dev/null)"; done'),
    run('df -k /data'),
    run('dumpsys battery'),
    run('cd /sys/class/power_supply/battery 2>/dev/null && for f in cycle_count charge_full charge_full_design; do [ -r $f ] && echo "$f $(cat $f)"; done'),
    run('wm size'),
    run('wm density'),
    run('cat /sys/devices/system/cpu/present'),
    run('pm list features'),
    run('getevent -pl 2>/dev/null | grep -c ABS_MT_POSITION_X'),
    run('for p in /system/bin/su /system/xbin/su /sbin/su /su/bin/su /debug_ramdisk/su; do [ -e $p ] && echo $p; done; command -v su'),
    run('cat /proc/uptime'),
    run('dumpsys power | grep -m1 -E "mWakefulness="'),
  ]);

  const props = parseGetprop(getpropOut);
  const prop = (...keys: string[]) => keys.map((key) => props[key]?.trim()).find((value) => value) || null;
  const sdk = Number(prop('ro.build.version.sdk')) || null;

  // RAM : MemTotal exclut la mémoire réservée au noyau/modem, d'où le palier supérieur.
  const memKb = Number(meminfoOut.match(/MemTotal:\s+(\d+)/i)?.[1] || 0);
  const ramRawGb = memKb ? memKb / 1024 / 1024 : null;
  const ramGb = ramRawGb ? ceilToStandard(ramRawGb, STANDARD_RAM_GB, 0) : null;
  if (!ramGb) warnings.push('RAM non lisible via ADB.');

  // Stockage : taille brute de la puce (UFS/eMMC, secteurs de 512 o) ; sinon partition /data.
  let storageRawGb: number | null = null;
  let storageSource: string | null = null;
  const blocks = blockOut.split('\n').map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && /^\d+$/.test(cols[1]) && cols[2] !== '1')
    .map((cols) => Number(cols[1]) * 512 / 1e9);
  if (blocks.length) {
    storageRawGb = Math.max(...blocks);
    storageSource = 'Puce de stockage (taille brute)';
  }
  const df = parseDfData(dfOut);
  if (!storageRawGb && df?.totalKb) {
    storageRawGb = (df.totalKb * 1024) / 1e9;
    storageSource = 'Partition /data (hors système)';
  }
  const storageGb = storageRawGb ? ceilToStandard(storageRawGb, STANDARD_STORAGE_GB, storageSource?.startsWith('Puce') ? 0.03 : 0) : null;
  if (!storageGb) warnings.push('Capacité de stockage non lisible via ADB : à confirmer par le client.');

  const batteryField = (name: string) => batteryOut.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? null;
  const batterySys = Object.fromEntries(batterySysOut.split('\n').map((line) => line.trim().split(/\s+/)).filter((cols) => cols.length === 2).map(([key, value]) => [key, Number(value)]));
  const level = Number(batteryField('level'));
  const temperature = Number(batteryField('temperature'));
  const voltage = Number(batteryField('voltage'));
  const status = batteryField('status');
  const cycleCount = batterySys.cycle_count || Number(batteryField('Charge cycles') || batteryField('cycle count')) || null;
  const capacityPercent = batterySys.charge_full && batterySys.charge_full_design
    ? Math.min(100, Math.round((batterySys.charge_full / batterySys.charge_full_design) * 100))
    : null;

  const resolution = (wmSizeOut.match(/Override size:\s*(\d+x\d+)/) || wmSizeOut.match(/Physical size:\s*(\d+x\d+)/))?.[1] ?? null;
  const physicalResolution = wmSizeOut.match(/Physical size:\s*(\d+x\d+)/)?.[1] ?? resolution;
  const density = Number(wmDensityOut.match(/Physical density:\s*(\d+)/)?.[1]) || null;
  const coresRange = cpuOut.trim().match(/^(\d+)-(\d+)$/);
  const cpuCores = coresRange ? Number(coresRange[2]) - Number(coresRange[1]) + 1 : null;

  const bootState = prop('ro.boot.verifiedbootstate');
  const flashLocked = prop('ro.boot.flash.locked');
  if (bootState && bootState !== 'green') warnings.push(`Démarrage vérifié « ${bootState} » : bootloader déverrouillé ou système modifié, les données lues peuvent être falsifiées.`);

  // IMEI : getDeviceId / getDeviceIdForPhone d'IPhoneSubInfo. Le shell ADB y a accès sur beaucoup
  // d'appareils, mais certains constructeurs le bloquent : l'échec est normal et affiché tel quel.
  const imeiCommands = ['service call iphonesubinfo 1 s16 com.android.shell'];
  if (sdk && sdk >= 30) imeiCommands.push('service call iphonesubinfo 4 i32 0 s16 com.android.shell s16 null', 'service call iphonesubinfo 4 i32 1 s16 com.android.shell s16 null');
  else if (sdk && sdk >= 23) imeiCommands.push('service call iphonesubinfo 3 i32 0 s16 com.android.shell', 'service call iphonesubinfo 3 i32 1 s16 com.android.shell');
  const imeis: string[] = [];
  for (const command of imeiCommands) {
    const imei = parseParcelString(await run(command));
    if (imei && isValidImei(imei) && IMEI_REPORTING_BODIES.has(imei.slice(0, 2)) && !imeis.includes(imei)) imeis.push(imei);
  }
  if (!imeis.length) warnings.push('Android refuse la lecture de l’IMEI par ADB sur cet appareil : saisie ou scan requis.');

  // Composants : liste officielle des fonctionnalités matérielles déclarées par le constructeur.
  const features = new Set(featuresOut.split('\n').map((line) => line.replace(/^feature:/, '').split('=')[0].trim()).filter(Boolean));
  const has = (...names: string[]) => names.some((name) => features.has(name));
  const components: Record<string, boolean> = features.size ? {
    'Appareil photo arrière': has('android.hardware.camera'),
    'Appareil photo avant': has('android.hardware.camera.front'),
    'Flash': has('android.hardware.camera.flash'),
    'Empreinte digitale': has('android.hardware.fingerprint'),
    'NFC': has('android.hardware.nfc'),
    'GPS': has('android.hardware.location.gps'),
    'Accéléromètre': has('android.hardware.sensor.accelerometer'),
    'Gyroscope': has('android.hardware.sensor.gyroscope'),
    'Capteur de proximité': has('android.hardware.sensor.proximity'),
    'Capteur de luminosité': has('android.hardware.sensor.light'),
    'Boussole': has('android.hardware.sensor.compass'),
    'Multi-touch': has('android.hardware.touchscreen.multitouch'),
    'Bluetooth': has('android.hardware.bluetooth'),
    'Wi-Fi': has('android.hardware.wifi'),
    '4G / téléphonie': has('android.hardware.telephony'),
  } : {};
  const touchCount = Number(touchOut.trim());
  const rooted = suOut.trim().length > 0;
  if (rooted) warnings.push('Accès root détecté (binaire su) : le système peut être modifié, les données lues sont moins fiables.');
  const simState = prop('gsm.sim.state');
  const uptimeSeconds = Number(uptimeOut.trim().split(/\s+/)[0]);
  const wakefulness = powerOut.match(/mWakefulness=(\w+)/)?.[1];

  const diagnostic: DeviceDiagnostic = {
    source: 'USB_ADB',
    collectedAt: new Date().toISOString(),
    brand: prop('ro.product.brand', 'ro.product.vendor.brand'),
    manufacturer: prop('ro.product.manufacturer', 'ro.product.vendor.manufacturer'),
    model: prop('ro.product.model', 'ro.product.vendor.model'),
    marketName: prop('ro.product.marketname', 'ro.product.vendor.marketname', 'ro.product.odm.marketname', 'ro.config.marketing_name', 'ro.vendor.oplus.market.name', 'ro.product.oem.marketname'),
    device: prop('ro.product.device', 'ro.product.vendor.device'),
    androidVersion: prop('ro.build.version.release'),
    sdk,
    securityPatch: prop('ro.build.version.security_patch'),
    buildId: prop('ro.build.display.id'),
    soc: [prop('ro.soc.manufacturer'), prop('ro.soc.model')].filter(Boolean).join(' ') || prop('ro.board.platform', 'ro.hardware.chipname', 'ro.hardware'),
    cpuAbi: prop('ro.product.cpu.abi'),
    cpuCores,
    ramGb,
    ramRawGb: ramRawGb ? round1(ramRawGb) : null,
    storageGb,
    storageRawGb: storageRawGb ? round1(storageRawGb) : null,
    storageSource,
    dataUsedGb: df ? round1((df.usedKb * 1024) / 1e9) : null,
    dataFreeGb: df ? round1((df.freeKb * 1024) / 1e9) : null,
    screenResolution: physicalResolution,
    screenDensity: density,
    battery: batteryOut ? {
      level: Number.isFinite(level) && batteryField('level') ? level : null,
      charging: status ? status === '2' || status === '5' : null,
      health: BATTERY_HEALTH[batteryField('health') || ''] ?? null,
      temperatureC: Number.isFinite(temperature) && batteryField('temperature') ? temperature / 10 : null,
      voltageMv: Number.isFinite(voltage) && batteryField('voltage') ? voltage : null,
      technology: batteryField('technology'),
      cycleCount,
      capacityPercent,
    } : null,
    verifiedBootState: bootState,
    bootloaderLocked: flashLocked === null ? null : flashLocked === '1',
    imeiRead: imeis.length ? 'READ' : 'DENIED',
    imeiCount: imeis.length,
    hardware: {
      components,
      touchController: touchOut ? touchCount > 0 : null,
      // « LOADED,ABSENT » = double SIM : emplacement 1 occupé, emplacement 2 vide.
      simState: simState ? simState.split(',').map((state, index, all) => `${all.length > 1 ? `${index + 1} ` : ''}${({ LOADED: 'insérée', READY: 'insérée', ABSENT: 'vide', PIN_REQUIRED: 'verrouillée (PIN)', PUK_REQUIRED: 'bloquée (PUK)', NOT_READY: 'non prête', UNKNOWN: 'inconnue' } as Record<string, string>)[state.trim()] || state.trim()}`).join(' · SIM ') : null,
      rooted: suOut === '' ? false : rooted,
      uptimeHours: Number.isFinite(uptimeSeconds) && uptimeSeconds > 0 ? Math.round(uptimeSeconds / 360) / 10 : null,
      screenOn: wakefulness ? wakefulness === 'Awake' : null,
    },
    warnings,
  };
  return { diagnostic, imeis };
}

/** Diagnostic accessible au navigateur du téléphone (mode QR / lien direct). Moins fiable que l'USB. */
export async function collectWebDiagnostic(): Promise<DeviceDiagnostic> {
  const nav = navigator as any;
  const warnings: string[] = [];
  let model: string | null = null;
  let platformVersion: string | null = null;
  let platform: string | null = null;
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']);
    model = hints?.model || null;
    platformVersion = hints?.platformVersion || null;
    platform = hints?.platform || nav.userAgentData?.platform || null;
  } catch { /* Safari/Firefox : pas de Client Hints */ }

  const ua = navigator.userAgent;
  // UA réduit de Chrome (« Android 10; K ») : version et modèle figés, donc faux.
  const reducedUa = /Android 10; K\)/.test(ua);
  const androidVersion = (platform === 'Android' && platformVersion ? platformVersion.replace(/\.0(\.0)?$/, '') : null)
    ?? (reducedUa ? null : ua.match(/Android\s([\d.]+)/)?.[1] ?? null);
  if (!model && !reducedUa) model = ua.match(/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build|\))/i)?.[1]?.trim() ?? null;
  // Apple : modèle déduit de l'écran et de la version d'iOS (Safari ne publie jamais le modèle).
  const apple = identifyApple(ua, window.screen.width, window.screen.height, window.devicePixelRatio || 1, navigator.maxTouchPoints || 0);
  if (apple) model = null;
  // « Version pour ordinateur » : UA de PC Linux alors que le processeur est ARM et l'écran tactile.
  // Un iPad se présente aussi comme un Mac tactile, mais ce n'est pas ce mode.
  const armPlatform = /arm|aarch/i.test(navigator.platform || '');
  const desktopMode = !apple && !/Android|iPhone|iPad/.test(ua) && (armPlatform || navigator.maxTouchPoints > 1);
  if (desktopMode) {
    warnings.push('Le navigateur du téléphone est en mode « Version pour ordinateur » : il masque le modèle et la version Android. Désactivez-le (menu ⋮) puis rescannez le QR code.');
  } else if (apple) {
    if (apple.candidates.length !== 1) warnings.push(`Safari ne communique pas le modèle exact : ${apple.candidates.length ? 'modèles possibles d’après l’écran' : 'écran non répertorié'}. Le scan de la boîte ou de Réglages › Général › Informations donne le modèle exact.`);
  } else if (!model) {
    warnings.push(nav.brave ? 'Brave masque le modèle exact : ouvrez le QR code avec Chrome pour un diagnostic plus complet.' : 'Le navigateur ne communique pas le modèle exact.');
  }


  let battery: DeviceDiagnostic['battery'] = null;
  try {
    const manager = await nav.getBattery?.();
    if (manager) battery = { level: Math.round(manager.level * 100), charging: manager.charging };
  } catch { /* API batterie absente */ }

  let gpu: string | null = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && debugInfo) gpu = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') || null;
  } catch { /* WebGL indisponible */ }

  const dpr = window.devicePixelRatio || 1;
  // floor : le ratio de pixels arrondi donne sinon 1081x2401 pour un écran 1080x2400.
  const width = Math.floor(window.screen.width * dpr);
  const height = Math.floor(window.screen.height * dpr);
  // navigator.deviceMemory est plafonné à 8 par Chrome : indicatif seulement.
  const deviceMemory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  warnings.push('Données fournies par le navigateur : indicatives, non opposables (le stockage et l’IMEI ne sont pas accessibles depuis le web).');

  return {
    source: 'WEB_BROWSER',
    collectedAt: new Date().toISOString(),
    brand: apple ? 'Apple' : null,
    model,
    marketName: apple ? (apple.candidates.length ? apple.candidates.join(' / ') : `${apple.kind} (modèle non déterminé)`) : null,
    modelCandidates: apple?.candidates,
    modelSource: apple ? 'Déduit de l’écran et de la version d’iOS' : null,
    androidVersion,
    buildId: apple ? `${apple.kind === 'iPad' ? 'iPadOS' : 'iOS'} ${apple.iosVersion ?? '(version masquée)'}` : (!androidVersion && (armPlatform || platform === 'Android') ? 'Android (version masquée par le navigateur)' : null),
    cpuCores: navigator.hardwareConcurrency || null,
    gpu,
    ramGb: deviceMemory && deviceMemory < 8 ? deviceMemory : null,
    ramRawGb: deviceMemory,
    screenResolution: `${Math.min(width, height)}x${Math.max(width, height)}`,
    screenDensity: Math.round(dpr * 160),
    battery,
    imeiRead: 'NOT_ATTEMPTED',
    imeiCount: 0,
    desktopMode,
    warnings,
  };
}
