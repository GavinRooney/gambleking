// ─── Market / odds position scoring ─────────────────────────────────────────

/**
 * Score based on market position (rank in betting).
 * The favorite (rank 1) scores highest; diminishing returns for outsiders.
 *
 * @param marketRank — 1 = favorite, 2 = second fav, etc. Null if no data.
 * @returns 0-100 score
 */
export function scoreMarket(marketRank: number | null): number {
  if (marketRank == null) return 50;

  if (marketRank <= 0) return 50; // invalid data

  switch (marketRank) {
    case 1:
      return 90;
    case 2:
      return 80;
    case 3:
      return 70;
    case 4:
      return 60;
    case 5:
      return 52;
    case 6:
      return 45;
    default:
      // Rank 7+ gets progressively lower, floor at 20
      return Math.max(20, 45 - (marketRank - 6) * 5);
  }
}
