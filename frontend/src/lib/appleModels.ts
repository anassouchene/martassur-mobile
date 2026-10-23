// Safari ne publie jamais le modèle d'iPhone / d'iPad. L'écran (taille en points CSS + densité)
// et la version d'iOS le restreignent à quelques modèles possibles : on affiche cette liste,
// jamais un modèle unique inventé. Noms alignés sur la base TAC (« APPLE IPHONE XR »…).

interface AppleModel { name: string; minIos?: number; maxIos?: number }
interface AppleScreen { kind: 'iPhone' | 'iPad'; w: number; h: number; dpr: number; models: AppleModel[] }

const APPLE_SCREENS: AppleScreen[] = [
  // iPhone
  { kind: 'iPhone', w: 320, h: 568, dpr: 2, models: [{ name: 'iPhone 5', maxIos: 10 }, { name: 'iPhone 5C', maxIos: 10 }, { name: 'iPhone 5S', maxIos: 12 }, { name: 'iPhone SE', maxIos: 15 }] },
  { kind: 'iPhone', w: 375, h: 667, dpr: 2, models: [{ name: 'iPhone 6', maxIos: 12 }, { name: 'iPhone 6S', maxIos: 15 }, { name: 'iPhone 7', maxIos: 15 }, { name: 'iPhone 8', maxIos: 16 }, { name: 'iPhone SE (2nd gen)', minIos: 13.4 }, { name: 'iPhone SE (3rd gen)', minIos: 15.4 }] },
  { kind: 'iPhone', w: 414, h: 736, dpr: 3, models: [{ name: 'iPhone 6 Plus', maxIos: 12 }, { name: 'iPhone 6S Plus', maxIos: 15 }, { name: 'iPhone 7 Plus', maxIos: 15 }, { name: 'iPhone 8 Plus', maxIos: 16 }] },
  { kind: 'iPhone', w: 375, h: 812, dpr: 3, models: [{ name: 'iPhone X', maxIos: 16 }, { name: 'iPhone XS', maxIos: 18 }, { name: 'iPhone 11 Pro', minIos: 13 }, { name: 'iPhone 12 mini', minIos: 14.1 }, { name: 'iPhone 13 mini', minIos: 15 }] },
  { kind: 'iPhone', w: 414, h: 896, dpr: 2, models: [{ name: 'iPhone XR', maxIos: 18 }, { name: 'iPhone 11', minIos: 13 }] },
  { kind: 'iPhone', w: 414, h: 896, dpr: 3, models: [{ name: 'iPhone XS Max', maxIos: 18 }, { name: 'iPhone 11 Pro Max', minIos: 13 }] },
  { kind: 'iPhone', w: 390, h: 844, dpr: 3, models: [{ name: 'iPhone 12', minIos: 14.1 }, { name: 'iPhone 12 Pro', minIos: 14.1 }, { name: 'iPhone 13', minIos: 15 }, { name: 'iPhone 13 Pro', minIos: 15 }, { name: 'iPhone 14', minIos: 16 }, { name: 'iPhone 16e', minIos: 18.3 }] },
  { kind: 'iPhone', w: 428, h: 926, dpr: 3, models: [{ name: 'iPhone 12 Pro Max', minIos: 14.1 }, { name: 'iPhone 13 Pro Max', minIos: 15 }, { name: 'iPhone 14 Plus', minIos: 16 }] },
  { kind: 'iPhone', w: 393, h: 852, dpr: 3, models: [{ name: 'iPhone 14 Pro', minIos: 16 }, { name: 'iPhone 15', minIos: 17 }, { name: 'iPhone 15 Pro', minIos: 17 }, { name: 'iPhone 16', minIos: 18 }] },
  { kind: 'iPhone', w: 430, h: 932, dpr: 3, models: [{ name: 'iPhone 14 Pro Max', minIos: 16 }, { name: 'iPhone 15 Plus', minIos: 17 }, { name: 'iPhone 15 Pro Max', minIos: 17 }, { name: 'iPhone 16 Plus', minIos: 18 }] },
  { kind: 'iPhone', w: 402, h: 874, dpr: 3, models: [{ name: 'iPhone 16 Pro', minIos: 18 }, { name: 'iPhone 17', minIos: 26 }, { name: 'iPhone 17 Pro', minIos: 26 }] },
  { kind: 'iPhone', w: 440, h: 956, dpr: 3, models: [{ name: 'iPhone 16 Pro Max', minIos: 18 }, { name: 'iPhone 17 Pro Max', minIos: 26 }] },
  { kind: 'iPhone', w: 420, h: 912, dpr: 3, models: [{ name: 'iPhone Air', minIos: 26 }] },
  // iPad (iPadOS 13+ se présente comme un Mac : détecté par l'écran tactile)
  { kind: 'iPad', w: 768, h: 1024, dpr: 2, models: [{ name: 'iPad (5th gen)', maxIos: 16 }, { name: 'iPad (6th gen)', maxIos: 17 }, { name: 'iPad Air 2', maxIos: 15 }, { name: 'iPad mini 4', maxIos: 15 }, { name: 'iPad mini (5th gen)', minIos: 12.2 }, { name: 'iPad Pro 9.7-inch', maxIos: 16 }] },
  { kind: 'iPad', w: 810, h: 1080, dpr: 2, models: [{ name: 'iPad (7th gen)', minIos: 13.1, maxIos: 18 }, { name: 'iPad (8th gen)', minIos: 14 }, { name: 'iPad (9th gen)', minIos: 15 }] },
  { kind: 'iPad', w: 820, h: 1180, dpr: 2, models: [{ name: 'iPad Air (4th gen)', minIos: 14 }, { name: 'iPad Air (5th gen)', minIos: 15.4 }, { name: 'iPad (10th gen)', minIos: 16.1 }, { name: 'iPad Air 11-inch (M2)', minIos: 17.5 }, { name: 'iPad Air 11-inch (M3)', minIos: 18.4 }, { name: 'iPad (A16)', minIos: 18.4 }] },
  { kind: 'iPad', w: 834, h: 1112, dpr: 2, models: [{ name: 'iPad Air (3rd gen)', minIos: 12.2 }, { name: 'iPad Pro 10.5-inch', maxIos: 17 }] },
  { kind: 'iPad', w: 834, h: 1194, dpr: 2, models: [{ name: 'iPad Pro 11-inch (1st gen)', minIos: 12.1 }, { name: 'iPad Pro 11-inch (2nd gen)', minIos: 13.4 }, { name: 'iPad Pro 11-inch (3rd gen)', minIos: 14.5 }, { name: 'iPad Pro 11-inch (4th gen)', minIos: 16.1 }] },
  { kind: 'iPad', w: 834, h: 1210, dpr: 2, models: [{ name: 'iPad Pro 11-inch (M4)', minIos: 17.5 }] },
  { kind: 'iPad', w: 744, h: 1133, dpr: 2, models: [{ name: 'iPad mini (6th gen)', minIos: 15 }, { name: 'iPad mini (A17 Pro)', minIos: 18 }] },
  { kind: 'iPad', w: 1024, h: 1366, dpr: 2, models: [{ name: 'iPad Pro 12.9-inch', minIos: 9 }, { name: 'iPad Air 13-inch (M2)', minIos: 17.5 }, { name: 'iPad Air 13-inch (M3)', minIos: 18.4 }] },
  { kind: 'iPad', w: 1032, h: 1376, dpr: 2, models: [{ name: 'iPad Pro 13-inch (M4)', minIos: 17.5 }] },
];

export interface AppleIdentification {
  kind: 'iPhone' | 'iPad';
  candidates: string[];
  iosVersion: string | null;
}

/** iPhone (UA « iPhone ») ou iPad (UA « iPad », ou « Macintosh » + écran tactile depuis iPadOS 13). */
export const detectAppleKind = (ua: string, maxTouchPoints: number): 'iPhone' | 'iPad' | null =>
  /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1) ? 'iPad' : null;

/**
 * Version d'iOS : Safari 26 fige le jeton « OS 18_6 » mais publie la vraie version dans « Version/26.x ».
 * `reliable` = version issue de Safari (sert à exclure les modèles trop récents ; jamais l'inverse).
 */
export const parseIosVersion = (ua: string): { version: string | null; reliable: boolean } => {
  const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) ? ua.match(/Version\/(\d+(?:\.\d+)?)/)?.[1] : undefined;
  const os = ua.match(/OS (\d+(?:_\d+)*) like Mac OS X/)?.[1]?.replace(/_/g, '.');
  return safari ? { version: safari, reliable: true } : { version: os ?? null, reliable: false };
};

export function identifyApple(ua: string, screenWidth: number, screenHeight: number, dpr: number, maxTouchPoints: number): AppleIdentification | null {
  const kind = detectAppleKind(ua, maxTouchPoints);
  if (!kind) return null;
  const { version, reliable } = parseIosVersion(ua);
  const ios = version ? parseFloat(version) : null;
  const w = Math.min(screenWidth, screenHeight);
  const h = Math.max(screenWidth, screenHeight);
  const screen = APPLE_SCREENS.find((entry) => entry.kind === kind && entry.w === w && entry.h === h && Math.abs(entry.dpr - dpr) < 0.1);
  const candidates = (screen?.models ?? [])
    // Version trop récente pour l'appareil (sortie de support) : toujours fiable, la version publiée n'est jamais supérieure à la réelle.
    .filter((model) => !(ios !== null && model.maxIos !== undefined && Math.floor(ios) > model.maxIos))
    // Version antérieure à la sortie du modèle : seulement si Safari donne la vraie version.
    .filter((model) => !(reliable && ios !== null && model.minIos !== undefined && ios < model.minIos))
    .map((model) => model.name);
  return { kind, candidates, iosVersion: version };
}
