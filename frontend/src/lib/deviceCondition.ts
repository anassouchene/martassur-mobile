// Constat visuel de l'état du téléphone (analyse des photos recto/verso).

export interface DeviceCondition {
  screenOn?: boolean | null;
  screenDamage?: string[];
  backDamage?: string[];
  cameraLensDamage?: boolean | null;
  overallCondition?: string | null;
  notes?: string | null;
}

const SCREEN_LABELS: Record<string, string> = {
  cracks: 'écran fissuré', dead_pixels: 'pixels morts', lines: 'lignes à l’écran', spots: 'taches sur l’affichage',
  burn_in: 'image rémanente', dim_or_flicker: 'affichage faible ou scintillant',
};
const BACK_LABELS: Record<string, string> = { cracks: 'dos fissuré', scratches: 'rayures', dents: 'bosses', missing_parts: 'pièces manquantes' };
export const CONDITION_LABELS: Record<string, string> = { excellent: 'Excellent', good: 'Bon', fair: 'Usé', poor: 'Abîmé' };

/** Défauts constatés, en français ; liste vide = rien de visible. */
export const conditionDefects = (condition?: DeviceCondition | null): string[] => [
  ...(condition?.screenDamage ?? []).map((code) => SCREEN_LABELS[code] ?? code),
  ...(condition?.backDamage ?? []).map((code) => BACK_LABELS[code] ?? code),
  ...(condition?.cameraLensDamage ? ['objectif photo abîmé'] : []),
];

/** Champs de l'analyse brute (flags stockés : clés snake_case) → DeviceCondition. */
export const conditionFromAnalysis = (result: any): DeviceCondition | null => !result ? null : ({
  screenOn: result.screen_on ?? null,
  screenDamage: result.screen_damage ?? [],
  backDamage: result.back_damage ?? [],
  cameraLensDamage: result.camera_lens_damage ?? null,
  overallCondition: result.overall_condition ?? null,
  notes: result.damage_notes ?? null,
});
