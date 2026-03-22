import { syncOdds } from "@/lib/data-sources/sync";

/**
 * Hourly odds update — runs every hour during racing hours (11am-6pm)
 */
export async function oddsUpdate() {
  const now = new Date();
  const hour = now.getHours();

  // Only update during UK racing hours
  if (hour < 11 || hour > 18) {
    console.log(`[CRON] Odds update skipped — outside racing hours (${hour}:00)`);
    return null;
  }

  console.log(`[CRON] Odds update starting`);

  try {
    const result = await syncOdds();
    console.log(`[CRON] Odds updated:`, result);
    return result;
  } catch (error) {
    console.error(`[CRON] Odds update failed:`, error);
    throw error;
  }
}
