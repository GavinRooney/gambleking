// ─── Recent form scoring (last 5 runs) ──────────────────────────────────────

const POSITION_SCORES: Record<number, number> = {
  1: 100,
  2: 80,
  3: 65,
  4: 50,
};
const DEFAULT_POSITION_SCORE = 30;

/**
 * Score a horse's recent form based on finish positions (most recent first).
 * More recent runs carry a higher weight via exponential decay.
 *
 * @param finishPositions — finish positions of last N runs, newest first
 * @returns 0-100 score
 */
export function scoreForm(finishPositions: number[]): number {
  if (finishPositions.length === 0) return 50; // neutral when no data

  const maxRuns = 5;
  const runs = finishPositions.slice(0, maxRuns);

  // Decay factor: most recent run = highest weight
  const decayBase = 0.8;
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < runs.length; i++) {
    const pos = runs[i];
    const score = POSITION_SCORES[pos] ?? DEFAULT_POSITION_SCORE;
    const weight = Math.pow(decayBase, i); // 1.0, 0.8, 0.64, 0.51, 0.41
    weightedSum += score * weight;
    totalWeight += weight;
  }

  return Math.round(weightedSum / totalWeight);
}
