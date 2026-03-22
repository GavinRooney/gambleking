// ─── Going preference scoring ───────────────────────────────────────────────

/**
 * Ordered going categories from firmest to softest.
 * The "distance" between categories is used to judge how far apart two goings
 * are — one step apart is "similar", two+ steps apart gets progressively worse.
 */
const GOING_ORDER = ["firm", "good_to_firm", "good", "good_to_soft", "soft", "heavy"] as const;
type GoingCategory = (typeof GOING_ORDER)[number];

interface GoingRecord {
  going: string;
  wins: number;
  runs: number;
  winPct: number;
}

/**
 * Normalize a going string from the DB or API into our canonical category.
 * Handles common variations like "Good to Soft", "good-to-firm", "Good (Good to Soft in places)" etc.
 */
function normalizeGoing(raw: string): GoingCategory {
  const s = raw.toLowerCase().replace(/[^a-z ]/g, " ").trim();

  if (s.includes("heavy")) return "heavy";
  if (s.includes("soft") && s.includes("good")) return "good_to_soft";
  if (s.includes("soft")) return "soft";
  if (s.includes("firm") && s.includes("good")) return "good_to_firm";
  if (s.includes("firm")) return "firm";
  return "good"; // default fallback
}

function goingIndex(going: GoingCategory): number {
  return GOING_ORDER.indexOf(going);
}

/**
 * Score how well the race going matches the horse's going preferences.
 *
 * @param raceGoing — the going description for today's race
 * @param goingPreferences — the horse's going records from GoingPreference table
 * @returns 0-100 score
 */
export function scoreGoing(
  raceGoing: string | null,
  goingPreferences: GoingRecord[],
): number {
  if (!raceGoing || goingPreferences.length === 0) return 50;

  const raceGoingNorm = normalizeGoing(raceGoing);
  const raceIdx = goingIndex(raceGoingNorm);

  // Find the horse's best going (highest win pct, break ties by most wins)
  const sorted = [...goingPreferences].sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    return b.wins - a.wins;
  });

  const bestGoingNorm = normalizeGoing(sorted[0].going);
  const bestIdx = goingIndex(bestGoingNorm);

  const distance = Math.abs(raceIdx - bestIdx);

  // Also check if horse has run AND won on this going
  const matchingPref = goingPreferences.find(
    (p) => normalizeGoing(p.going) === raceGoingNorm,
  );
  if (matchingPref && matchingPref.wins > 0) {
    // Won on this going before — bonus based on win rate
    return Math.min(100, 80 + Math.round(matchingPref.winPct * 20));
  }

  // Score based on distance from best going
  switch (distance) {
    case 0:
      return 100;
    case 1:
      return 70;
    case 2:
      return 50;
    case 3:
      return 35;
    default:
      return 20;
  }
}
