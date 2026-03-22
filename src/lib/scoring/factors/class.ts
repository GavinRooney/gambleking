// ─── Class level change scoring ─────────────────────────────────────────────

/**
 * Score based on whether the horse is dropping, maintaining, or rising in class.
 *
 * Lower class number = higher quality race in UK/IRE (Class 1 is best, Class 7 lowest).
 * We also look at officialRating as a proxy: a high-rated horse in a low-class race
 * is effectively dropping in class.
 *
 * @param raceClass — the class of today's race (1-7, lower = better)
 * @param typicalClass — the horse's typical class level (from recent runs), or null
 * @param officialRating — horse's official rating, or null
 * @param averageFieldRating — average OR of runners in this race, or null
 * @returns 0-100 score
 */
export function scoreClass(
  raceClass: number | null,
  typicalClass: number | null,
  officialRating: number | null,
  averageFieldRating: number | null,
): number {
  // If we have class data for both horse and race, use it directly
  if (raceClass != null && typicalClass != null) {
    const diff = typicalClass - raceClass;
    // diff > 0 means horse usually runs in higher class number = lower quality
    // so they are DROPPING to a better (lower number) race — wait, that's rising.
    // Actually: higher class number = weaker race.
    // typicalClass 5, raceClass 3 → diff = 2, horse moving UP in quality → bad for them
    // typicalClass 3, raceClass 5 → diff = -2, horse DROPPING in class → good for them

    if (diff <= -2) return 90; // significant class drop (easier race)
    if (diff === -1) return 75; // slight class drop
    if (diff === 0) return 60; // same class
    if (diff === 1) return 40; // slight rise
    return 30; // significant class rise
  }

  // Fall back to officialRating comparison
  if (officialRating != null && averageFieldRating != null) {
    const ratingEdge = officialRating - averageFieldRating;

    if (ratingEdge >= 10) return 90; // well above field average
    if (ratingEdge >= 5) return 75;
    if (ratingEdge >= 0) return 60;
    if (ratingEdge >= -5) return 45;
    return 30; // well below field
  }

  return 50; // no data — neutral
}
