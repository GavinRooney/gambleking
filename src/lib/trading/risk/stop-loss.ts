// Per-trade stop-loss — PRD §7.1.
//
// Once one leg of a paired scalp order has matched and the other is still
// unmatched, we have a one-sided exposure. If the market continues to move
// adversely, the open leg loses value with every tick. This module is the
// server-side process that watches for that and pulls the pin.
//
// Algorithm per tick (driven by the engine tick-loop):
//   for every trade with status=open:
//     identify matched leg(s) and unmatched leg(s) — both entry legs
//     if no single-sided exposure (both matched or both unmatched), skip
//     compute adverse ticks between entry price and current reference price:
//        matched BACK → adverse = currentBestBack rose above entryBackPrice
//        matched LAY  → adverse = currentBestLay  fell below entryLayPrice
//     if adverse ≥ stopLossTicks:
//        flattenTrade(client, tradeId, "stop_loss")
//
// The flattenTrade helper (in OMS) cancels the unmatched leg, places a
// crossing closing order for the open exposure, and stamps the trade with
// exitReason=stop_loss.

import { prisma } from "@/lib/db";
import type { BetAngelClient } from "../bet-angel/client";
import { ticksBetween } from "../ticks";
import { flattenTrade } from "../engine/oms";
import { getStrategyConfig } from "../strategy-config";

export async function tickStopLoss(client: BetAngelClient): Promise<void> {
  const config = await getStrategyConfig();
  const openTrades = await prisma.trade.findMany({
    where: { status: "open" },
    include: { orders: true, market: true, runner: true },
  });

  for (const trade of openTrades) {
    const back = trade.orders.find(
      (o) => o.side === "back" && o.purpose === "entry"
    );
    const lay = trade.orders.find(
      (o) => o.side === "lay" && o.purpose === "entry"
    );
    if (!back || !lay) continue;

    const backMatched = back.matchedSize;
    const layMatched = lay.matchedSize;
    // Only fire when exactly one side carries exposure. Two-sided (both
    // matched) trades close via tickOpenTrades; zero-sided (neither matched)
    // are still working, no stop-loss concern yet.
    if (backMatched === layMatched) continue;
    const matchedLeg = backMatched > layMatched ? back : lay;

    let prices;
    try {
      prices = await client.getMarketPrices(trade.market.betfairMarketId);
    } catch {
      continue;
    }
    const rp = prices.runners.find((r) => r.selectionId === trade.runner.selectionId);
    if (!rp) continue;

    const currentBestBack = rp.availableToBack[0]?.price ?? null;
    const currentBestLay = rp.availableToLay[0]?.price ?? null;
    if (currentBestBack == null || currentBestLay == null) continue;

    // For a matched BACK position: closing means laying, reference price is
    // current best-back. Adverse = currentBestBack > entryBackPrice.
    // For a matched LAY position: closing means backing, reference price is
    // current best-lay. Adverse = currentBestLay < entryLayPrice.
    let adverseTicks: number;
    if (matchedLeg.side === "back") {
      if (currentBestBack <= matchedLeg.price) continue; // not adverse
      try {
        adverseTicks = ticksBetween(matchedLeg.price, currentBestBack);
      } catch {
        continue; // price off-ladder; let next tick retry
      }
    } else {
      if (currentBestLay >= matchedLeg.price) continue;
      try {
        adverseTicks = ticksBetween(currentBestLay, matchedLeg.price);
      } catch {
        continue;
      }
    }

    if (adverseTicks < config.stopLossTicks) continue;

    await flattenTrade(client, trade.id, "stop_loss");
  }
}
