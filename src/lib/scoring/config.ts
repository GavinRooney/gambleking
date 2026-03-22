// ─── Scoring weight configuration per race type ─────────────────────────────

export interface ScoringWeights {
  recentForm: number;
  goingPreference: number;
  distanceSuitability: number;
  trainerForm: number;
  jockeyForm: number;
  courseForm: number;
  classChange: number;
  drawPosition: number;
  trainerJockeyCombo: number;
  marketPosition: number;
  weatherImpact: number;
}

export const FLAT_WEIGHTS: ScoringWeights = {
  recentForm: 0.22,
  goingPreference: 0.11,
  distanceSuitability: 0.11,
  trainerForm: 0.09,
  jockeyForm: 0.09,
  courseForm: 0.07,
  classChange: 0.09,
  drawPosition: 0.07,
  trainerJockeyCombo: 0.05,
  marketPosition: 0.05,
  weatherImpact: 0.05,
};

export const HURDLES_WEIGHTS: ScoringWeights = {
  recentForm: 0.22,
  goingPreference: 0.16,
  distanceSuitability: 0.13,
  trainerForm: 0.09,
  jockeyForm: 0.07,
  courseForm: 0.09,
  classChange: 0.07,
  drawPosition: 0.0,
  trainerJockeyCombo: 0.05,
  marketPosition: 0.07,
  weatherImpact: 0.05,
};

/**
 * Return the appropriate weights for a race type.
 * "flat" -> FLAT_WEIGHTS, everything else (hurdle, chase, NH) -> HURDLES_WEIGHTS.
 */
export function getWeights(raceType: string): ScoringWeights {
  const t = raceType.toLowerCase().trim();
  if (t === "flat") return FLAT_WEIGHTS;
  return HURDLES_WEIGHTS;
}
