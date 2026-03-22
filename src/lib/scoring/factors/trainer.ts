// ─── Trainer form scoring (14-day strike rate) ─────────────────────────────

/**
 * Score a trainer based on their 14-day strike rate.
 *
 * @param strikeRate14d — trainer's win percentage over last 14 days (0-100 scale, e.g. 25 = 25%)
 * @returns 0-100 score
 */
export function scoreTrainer(strikeRate14d: number | null): number {
  if (strikeRate14d == null) return 40; // unknown trainer form

  if (strikeRate14d >= 25) return 100;
  if (strikeRate14d >= 20) return 85;
  if (strikeRate14d >= 15) return 70;
  if (strikeRate14d >= 10) return 55;
  if (strikeRate14d >= 5) return 40;
  return 25;
}
