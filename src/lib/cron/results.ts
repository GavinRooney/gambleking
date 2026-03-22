import { syncResults } from "@/lib/data-sources/sync";
import { prisma } from "@/lib/db";

/**
 * Evening results sync — runs at 9pm
 * Fetches today's results and resolves pending bets
 */
export async function resultsSync() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`[CRON] Results sync starting for ${today}`);

  try {
    const syncResult = await syncResults("today");
    console.log(`[CRON] Results synced:`, syncResult);

    // Auto-resolve pending bets
    const resolvedCount = await resolvePendingBets();
    console.log(`[CRON] Resolved ${resolvedCount} bets`);

    return { syncResult, resolvedCount };
  } catch (error) {
    console.error(`[CRON] Results sync failed:`, error);
    throw error;
  }
}

async function resolvePendingBets(): Promise<number> {
  const pendingBets = await prisma.bet.findMany({
    where: { outcome: "pending" },
    include: {
      runner: {
        include: { race: true },
      },
    },
  });

  let resolved = 0;

  for (const bet of pendingBets) {
    const { runner } = bet;

    // Only resolve if the race has a result
    if (runner.finishPosition === null) continue;

    const won =
      bet.betType === "win"
        ? runner.finishPosition === 1
        : runner.finishPosition <= 3; // each_way places in top 3

    let profitLoss: number;
    if (won) {
      if (bet.betType === "win") {
        profitLoss = bet.stake * (bet.oddsTaken - 1);
      } else {
        // Each way: win part + place part (1/4 odds for place)
        if (runner.finishPosition === 1) {
          profitLoss =
            (bet.stake / 2) * (bet.oddsTaken - 1) +
            (bet.stake / 2) * ((bet.oddsTaken - 1) / 4);
        } else {
          // Placed but didn't win: lose win part, win place part
          profitLoss =
            -(bet.stake / 2) + (bet.stake / 2) * ((bet.oddsTaken - 1) / 4);
        }
      }
    } else {
      profitLoss = -bet.stake;
    }

    await prisma.bet.update({
      where: { id: bet.id },
      data: {
        outcome: won ? "won" : "lost",
        profitLoss,
      },
    });

    resolved++;
  }

  return resolved;
}
