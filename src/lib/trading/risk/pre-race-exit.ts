// Pre-race forced exit — PRD §7.2.
//
// The critical risk control: the system is architecturally incapable of
// holding an open position when a race goes in-play. Two stages:
//
//   Warning stage (config.preRaceWarningSeconds, default 60 s):
//     - Promote TradingMarket.status "scanning"/"trading" → "warned".
//     - OMS refuses to open NEW trades against warned markets (see
//       openTrade's market-status check). Existing open trades ride out.
//
//   Hard exit stage (config.preRaceExitSeconds, default 10 s):
//     - Promote TradingMarket.status → "exited".
//     - Flatten every open trade in that market with exitReason=forced_exit
//       (cancels unmatched legs, greens up any net single-sided exposure).
//
// Runs every engine tick. The race-start reference is TradingMarket.startTime
// which the scanner keeps in sync. M5a will swap this source to Betfair's
// listRaceDetails to account for delayed off-times; the logic here doesn't
// change.

import { prisma } from "@/lib/db";
import type { BetAngelClient } from "../bet-angel/client";
import { flattenTrade } from "../engine/oms";
import { getStrategyConfig } from "../strategy-config";

export async function tickPreRaceExit(
  client: BetAngelClient,
  now: Date = new Date()
): Promise<void> {
  const config = await getStrategyConfig();
  const warningMs = config.preRaceWarningSeconds * 1000;
  const hardExitMs = config.preRaceExitSeconds * 1000;

  const markets = await prisma.tradingMarket.findMany({
    where: { status: { in: ["scanning", "trading", "warned"] } },
  });

  for (const market of markets) {
    const msToStart = market.startTime.getTime() - now.getTime();

    if (msToStart <= hardExitMs) {
      // Hard exit: promote status and flatten every open trade.
      if (market.status !== "exited") {
        await prisma.tradingMarket.update({
          where: { id: market.id },
          data: { status: "exited" },
        });
      }
      const openTrades = await prisma.trade.findMany({
        where: { marketId: market.id, status: "open" },
      });
      for (const trade of openTrades) {
        try {
          await flattenTrade(client, trade.id, "forced_exit");
        } catch (err) {
          console.error("[pre-race-exit] flatten failed", trade.id, err);
        }
      }
      continue;
    }

    if (msToStart <= warningMs && market.status !== "warned") {
      await prisma.tradingMarket.update({
        where: { id: market.id },
        data: { status: "warned" },
      });
    }
  }
}
