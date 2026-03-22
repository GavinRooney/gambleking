// ─── Trainer / Jockey combo scoring ─────────────────────────────────────────

interface ComboStats {
  runs: number;
  wins: number;
}

/**
 * Score the trainer+jockey combination based on historical partnership results.
 *
 * @param comboStats — { runs, wins } for this trainer+jockey pair, or null if unknown
 * @returns 0-100 score
 */
export function scoreCombo(comboStats: ComboStats | null): number {
  if (!comboStats || comboStats.runs === 0) return 50; // unknown combo

  const winRate = comboStats.wins / comboStats.runs;

  if (winRate >= 0.2) return 95;
  if (winRate >= 0.1) return 90;
  if (winRate >= 0.05) return 70;
  return 60;
}
