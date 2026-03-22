// ─── Distance suitability scoring ───────────────────────────────────────────

/**
 * Ordered distance bands. The index is used to compute "adjacency".
 */
const DISTANCE_BANDS = ["5f-6f", "7f-8f", "9f-11f", "12f-14f", "15f+"] as const;

interface DistanceRecord {
  distanceBand: string;
  wins: number;
  runs: number;
  winPct: number;
}

/**
 * Map a race distance (in furlongs) to a distance band string.
 */
function furlongsToBand(furlongs: number): string {
  if (furlongs <= 6) return "5f-6f";
  if (furlongs <= 8) return "7f-8f";
  if (furlongs <= 11) return "9f-11f";
  if (furlongs <= 14) return "12f-14f";
  return "15f+";
}

function bandIndex(band: string): number {
  const idx = DISTANCE_BANDS.indexOf(band as (typeof DISTANCE_BANDS)[number]);
  return idx === -1 ? -1 : idx;
}

/**
 * Score how well a race distance matches the horse's distance preferences.
 *
 * @param raceDistanceFurlongs — the race distance in furlongs
 * @param distancePreferences — horse's distance records from DistancePreference table
 * @returns 0-100 score
 */
export function scoreDistance(
  raceDistanceFurlongs: number,
  distancePreferences: DistanceRecord[],
): number {
  if (distancePreferences.length === 0) return 50; // neutral

  const raceBand = furlongsToBand(raceDistanceFurlongs);
  const raceIdx = bandIndex(raceBand);

  // Find the horse's best distance band (highest win pct, break ties by most wins)
  const sorted = [...distancePreferences].sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.wins - a.wins;
  });

  const bestBand = sorted[0].distanceBand;
  const bestIdx = bandIndex(bestBand);

  // If best band is unknown, fall back to checking if they've run at race distance
  if (bestIdx === -1) return 50;

  // Check if horse has won at this exact distance band
  const matchingPref = distancePreferences.find((p) => p.distanceBand === raceBand);
  if (matchingPref && matchingPref.wins > 0) {
    return Math.min(100, 80 + Math.round(matchingPref.winPct * 20));
  }

  const distance = Math.abs(raceIdx - bestIdx);

  switch (distance) {
    case 0:
      return 100;
    case 1:
      return 70;
    case 2:
      return 45;
    default:
      return 30;
  }
}
