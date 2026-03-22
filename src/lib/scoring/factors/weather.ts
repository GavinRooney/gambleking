// ─── Weather impact scoring ─────────────────────────────────────────────────

interface GoingRecord {
  going: string;
  wins: number;
  winPct: number;
}

/**
 * Score based on how forecast weather will affect the going and whether
 * that benefits this horse.
 *
 * Rain forecast + already soft going → surface will get softer → boost for mud lovers.
 * Dry forecast + firm going → stays firm → boost for firm-ground specialists.
 *
 * @param weatherForecast — raw weather forecast string from race, or null
 * @param raceGoing — current going description
 * @param goingPreferences — horse's going records
 * @returns 0-100 score
 */
export function scoreWeather(
  weatherForecast: string | null,
  raceGoing: string | null,
  goingPreferences: GoingRecord[],
): number {
  if (!weatherForecast || !raceGoing || goingPreferences.length === 0) return 50;

  const forecast = weatherForecast.toLowerCase();
  const going = raceGoing.toLowerCase();

  const isRainy =
    forecast.includes("rain") ||
    forecast.includes("shower") ||
    forecast.includes("wet");
  const isDry =
    forecast.includes("dry") ||
    forecast.includes("sunny") ||
    forecast.includes("fine") ||
    forecast.includes("clear");

  const isSoftGoing =
    going.includes("soft") || going.includes("heavy");
  const isFirmGoing =
    going.includes("firm") || (going.includes("good") && !going.includes("soft"));

  // Find horse's best going by win pct
  const sorted = [...goingPreferences].sort((a, b) => b.winPct - a.winPct);
  const bestGoing = sorted[0].going.toLowerCase();

  const horsePrefersSoft =
    bestGoing.includes("soft") || bestGoing.includes("heavy");
  const horsePrefersFirm =
    bestGoing.includes("firm") || (bestGoing.includes("good") && !bestGoing.includes("soft"));

  // Rain + soft going → gets even softer → great for soft lovers
  if (isRainy && isSoftGoing && horsePrefersSoft) return 85;
  if (isRainy && isSoftGoing && horsePrefersFirm) return 25;

  // Rain + firm going → going may ease → slight advantage to versatile / soft horses
  if (isRainy && isFirmGoing && horsePrefersSoft) return 70;
  if (isRainy && isFirmGoing && horsePrefersFirm) return 40;

  // Dry + firm → stays firm → good for firm lovers
  if (isDry && isFirmGoing && horsePrefersFirm) return 80;
  if (isDry && isFirmGoing && horsePrefersSoft) return 30;

  // Dry + soft → may dry out a bit → slight advantage for firmer-ground horses
  if (isDry && isSoftGoing && horsePrefersFirm) return 65;
  if (isDry && isSoftGoing && horsePrefersSoft) return 55;

  return 50; // no clear advantage either way
}
