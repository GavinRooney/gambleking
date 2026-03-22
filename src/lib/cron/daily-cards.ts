import { syncRaceCards } from "@/lib/data-sources/sync";
import { scoreAllRaces } from "@/lib/scoring/engine";

/**
 * Daily race cards sync — runs at 7am
 * Fetches today's race cards and runs the scoring engine
 */
export async function dailyCardSync() {
  const today = new Date();
  console.log(`[CRON] Daily card sync starting for ${today.toISOString().split("T")[0]}`);

  try {
    const syncResult = await syncRaceCards("today");
    console.log(`[CRON] Synced cards:`, syncResult);

    const scoreResult = await scoreAllRaces(today);
    console.log(`[CRON] Scored races:`, scoreResult);

    // Also fetch tomorrow's cards if available
    try {
      const tomorrowResult = await syncRaceCards("tomorrow");
      console.log(`[CRON] Synced tomorrow's cards:`, tomorrowResult);
    } catch {
      console.log(`[CRON] Tomorrow's cards not yet available`);
    }

    return { syncResult, scoreResult };
  } catch (error) {
    console.error(`[CRON] Daily card sync failed:`, error);
    throw error;
  }
}
