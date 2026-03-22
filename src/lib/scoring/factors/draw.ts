// ─── Draw position bias scoring (flat only) ────────────────────────────────

interface DrawBias {
  /** Mapping of draw position (or range) to advantage score. */
  [key: string]: number;
}

/**
 * Score the draw position advantage for flat races.
 * Returns 50 (neutral) for non-flat races since draw is irrelevant over jumps.
 *
 * @param raceType — "flat", "hurdle", "chase", etc.
 * @param drawPosition — the horse's draw position (stall number)
 * @param numRunners — total runners in the race
 * @param drawBiasDataJson — JSON string of course draw bias data, or null
 * @param raceGoing — going description (soft going tends to favor low draws)
 * @returns 0-100 score
 */
export function scoreDraw(
  raceType: string,
  drawPosition: number | null,
  numRunners: number | null,
  drawBiasDataJson: string | null,
  raceGoing: string | null,
): number {
  // Non-flat races: draw is irrelevant
  if (raceType.toLowerCase() !== "flat") return 50;

  // No draw info available
  if (drawPosition == null) return 50;

  // If we have course-specific draw bias data, use it
  if (drawBiasDataJson) {
    try {
      const bias: DrawBias = JSON.parse(drawBiasDataJson);

      // Try exact stall number match
      const exactKey = String(drawPosition);
      if (exactKey in bias) {
        return clampScore(bias[exactKey]);
      }

      // Try range match (e.g. "1-4", "5-8")
      for (const [range, score] of Object.entries(bias)) {
        const match = range.match(/^(\d+)-(\d+)$/);
        if (match) {
          const low = parseInt(match[1], 10);
          const high = parseInt(match[2], 10);
          if (drawPosition >= low && drawPosition <= high) {
            return clampScore(score);
          }
        }
      }
    } catch {
      // Invalid JSON, fall through to heuristic
    }
  }

  // General heuristic: on soft/heavy ground, low draws tend to help
  // On good/firm ground, draw effect is weaker
  const totalRunners = numRunners ?? 12;
  const goingLower = (raceGoing ?? "").toLowerCase();
  const isSoft = goingLower.includes("soft") || goingLower.includes("heavy");

  // Normalize draw position relative to field size
  const drawPctile = drawPosition / totalRunners; // 0.0 (low) to 1.0+ (high)

  if (isSoft) {
    // Soft ground: low draws get a bigger advantage
    if (drawPctile <= 0.25) return 75;
    if (drawPctile <= 0.5) return 60;
    if (drawPctile <= 0.75) return 45;
    return 35;
  }

  // Good/firm ground: mild low-draw advantage at most courses
  if (drawPctile <= 0.25) return 60;
  if (drawPctile <= 0.5) return 55;
  if (drawPctile <= 0.75) return 50;
  return 45;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
