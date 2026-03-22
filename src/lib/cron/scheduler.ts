import cron from "node-cron";
import { dailyCardSync } from "./daily-cards";
import { oddsUpdate } from "./odds-update";
import { resultsSync } from "./results";

let initialized = false;

/**
 * Initialize all cron jobs.
 * Call this from a server-side initialization point.
 */
export function initCronJobs() {
  if (initialized) return;
  initialized = true;

  console.log("[CRON] Initializing cron jobs...");

  // 7:00 AM — fetch race cards and run scoring
  cron.schedule("0 7 * * *", async () => {
    try {
      await dailyCardSync();
    } catch (error) {
      console.error("[CRON] Daily card sync error:", error);
    }
  });

  // Every hour from 11am-6pm — update odds
  cron.schedule("0 11-18 * * *", async () => {
    try {
      await oddsUpdate();
    } catch (error) {
      console.error("[CRON] Odds update error:", error);
    }
  });

  // 9:00 PM — fetch results and resolve bets
  cron.schedule("0 21 * * *", async () => {
    try {
      await resultsSync();
    } catch (error) {
      console.error("[CRON] Results sync error:", error);
    }
  });

  console.log("[CRON] Cron jobs initialized:");
  console.log("  - Daily cards:  07:00");
  console.log("  - Odds update:  11:00-18:00 (hourly)");
  console.log("  - Results sync: 21:00");
}
