// Order Management System — PRD §6.3.
//
// Owns the lifecycle of every scalp trade:
//   openTrade()        — place paired back+lay orders via BetAngelClient,
//                        persist Trade + two TradeOrder rows, emit trade:open
//   tickOpenTrades()   — poll order statuses, promote fully-matched orders,
//                        close trades once both legs settle, emit trade:close
//   closeTrade()       — manual close / forced exit path used by the engine
//                        tick-loop and (later) the risk module in M3
//
// Responsibilities intentionally NOT in this module:
//   - Stop-loss detection and forced pre-race exit (M3 risk module)
//   - Deciding WHICH runners to open trades on (M2 tick-loop, driven by
//     runner-selector signals + StrategyConfig thresholds)
//
// Placement strategy: v1 uses "aggressive crossing" — back at best-lay, lay
// at best-back. Both legs cross the spread and fill immediately against any
// liquidity present. That makes the full trade lifecycle testable against
// the mock without needing to rely on price oscillation. A "rest-and-wait"
// placement (back at best-back, lay at best-lay — the classic Peter Webb
// scalp) is a future strategy toggle; the OMS interface doesn't care.

import { prisma } from "@/lib/db";
import type { Trade } from "@/generated/prisma/client";
import type { BetAngelClient, PlaceOrderResult } from "../bet-angel/client";
import { getBetAngelMode } from "../bet-angel";
import { tradingBus } from "../events";
import { computeGreenUp } from "../greening";
import {
  checkLayLiability,
  checkSessionSuspended,
  checkStakeLimit,
} from "../risk/limits";

export type OpenTradeResult =
  | { status: "opened"; trade: Trade }
  | { status: "skipped"; reason: string };

// Open a paired scalp on `runnerId`. Returns the persisted Trade row.
//
// `sessionId` links the trade to the owning TradingSession so analytics can
// segment P&L by session. `maxConcurrentPerMarket` enforces the PRD §6.3
// limit without requiring the caller to count.
export async function openTrade(
  client: BetAngelClient,
  args: {
    sessionId: string;
    runnerId: string;
    stake: number;
    maxConcurrentPerMarket: number;
  }
): Promise<OpenTradeResult> {
  // Non-bypassable risk checks — run BEFORE any DB work or order placement.
  const suspensionCheck = await checkSessionSuspended(args.sessionId);
  if (suspensionCheck.blocked) {
    return { status: "skipped", reason: suspensionCheck.reason };
  }
  const stakeCheck = await checkStakeLimit(args.stake);
  if (stakeCheck.blocked) {
    return { status: "skipped", reason: stakeCheck.reason };
  }

  const runner = await prisma.tradingRunner.findUnique({
    where: { id: args.runnerId },
    include: { market: true },
  });
  if (!runner) return { status: "skipped", reason: `runner ${args.runnerId} not found` };

  // Pre-race exit guard: once a market is "warned" (approaching the off-time)
  // or "exited" (past the hard-exit threshold), NEW trades are forbidden.
  // Existing open trades ride out via the pre-race-exit tick. PRD §7.2.
  if (runner.market.status !== "scanning" && runner.market.status !== "trading") {
    return {
      status: "skipped",
      reason: `market in ${runner.market.status} state — no new trades`,
    };
  }

  const openCount = await prisma.trade.count({
    where: { marketId: runner.marketId, status: "open" },
  });
  if (openCount >= args.maxConcurrentPerMarket) {
    return { status: "skipped", reason: `maxConcurrentTrades (${args.maxConcurrentPerMarket}) reached for market` };
  }

  // Read live best prices at the moment of placement. We don't trust the
  // cached values on TradingRunner because the selector tick and the OMS
  // tick may be ~500 ms apart.
  const prices = await client.getMarketPrices(runner.market.betfairMarketId);
  const rp = prices.runners.find((r) => r.selectionId === runner.selectionId);
  if (!rp || rp.status !== "ACTIVE") {
    return { status: "skipped", reason: "runner not active in live price book" };
  }
  const bestBack = rp.availableToBack[0]?.price ?? null;
  const bestLay = rp.availableToLay[0]?.price ?? null;
  if (bestBack == null || bestLay == null) {
    return { status: "skipped", reason: "empty book — no best-back or best-lay price" };
  }

  // The entry lay leg will fill at bestBack (crossing placement). Check its
  // liability BEFORE writing the Trade row so the row isn't orphaned if the
  // check rejects. Liability is only ever calculated against the entry leg;
  // flattenTrade's closing leg intentionally bypasses this check.
  const liabilityCheck = await checkLayLiability(bestBack, args.stake);
  if (liabilityCheck.blocked) {
    return { status: "skipped", reason: liabilityCheck.reason };
  }

  const mode = getBetAngelMode();

  // Create the Trade row BEFORE placing orders so we have a stable ID for
  // customerOrderRef (lets us correlate Betfair bet IDs back to our trade).
  const trade = await prisma.trade.create({
    data: {
      sessionId: args.sessionId,
      marketId: runner.marketId,
      runnerId: runner.id,
      entryBackPrice: bestLay, // back leg crosses at best-lay
      entryLayPrice: bestBack, // lay leg crosses at best-back
      stake: args.stake,
      status: "open",
      mode,
    },
  });

  // Place back + lay in parallel. If either fails we attempt best-effort
  // cleanup so we don't leave a single-sided exposure.
  let backResult: PlaceOrderResult;
  let layResult: PlaceOrderResult;
  try {
    [backResult, layResult] = await Promise.all([
      client.placeOrder({
        marketId: runner.market.betfairMarketId,
        selectionId: runner.selectionId,
        side: "back",
        price: bestLay,
        size: args.stake,
        persistenceType: "LAPSE",
        customerOrderRef: `${trade.id}:back`,
      }),
      client.placeOrder({
        marketId: runner.market.betfairMarketId,
        selectionId: runner.selectionId,
        side: "lay",
        price: bestBack,
        size: args.stake,
        persistenceType: "LAPSE",
        customerOrderRef: `${trade.id}:lay`,
      }),
    ]);
  } catch (err) {
    await prisma.trade.update({
      where: { id: trade.id },
      data: { status: "forced_exit", exitReason: "forced_exit", closedAt: new Date() },
    });
    throw err;
  }

  // Persist TradeOrder rows for each leg (one round-trip per row keeps the
  // DB writes straightforward; two orders per trade is a fixed 2x cost).
  await prisma.tradeOrder.createMany({
    data: [
      {
        tradeId: trade.id,
        side: "back",
        purpose: "entry",
        price: bestLay,
        size: args.stake,
        matchedSize: backResult.sizeMatched,
        status: orderStatusFor(backResult),
        betAngelBetId: backResult.betId,
      },
      {
        tradeId: trade.id,
        side: "lay",
        purpose: "entry",
        price: bestBack,
        size: args.stake,
        matchedSize: layResult.sizeMatched,
        status: orderStatusFor(layResult),
        betAngelBetId: layResult.betId,
      },
    ],
  });

  tradingBus.emit("trade:open", {
    tradeId: trade.id,
    marketId: runner.marketId,
    runnerId: runner.id,
    side: "back", // we always open back-first in the event payload convention
    stake: args.stake,
    entryPrice: bestLay,
    at: Date.now(),
  });

  // If both legs filled immediately (crossing placement against a liquid
  // book — the common path in mock + expected path in live scalping), the
  // trade is already at "matched". Close it right away.
  if (bothLegsFullyMatched(backResult, layResult, args.stake)) {
    await settleMatchedTrade(trade.id);
  }

  const finalTrade = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
  return { status: "opened", trade: finalTrade };
}

// Poll all open trades, sync their order state from the client, and close
// any trade whose both legs are now fully matched. Called every tick by the
// engine loop.
export async function tickOpenTrades(client: BetAngelClient): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { status: "open" },
    include: { orders: true },
  });

  for (const trade of openTrades) {
    let advanced = false;
    for (const order of trade.orders) {
      if (order.status !== "unmatched") continue;
      if (!order.betAngelBetId) continue;

      const live = await client.getOrderStatus(order.betAngelBetId);
      const nextStatus = mapExecutionStatus(live.status);
      if (
        live.sizeMatched !== order.matchedSize ||
        nextStatus !== order.status
      ) {
        await prisma.tradeOrder.update({
          where: { id: order.id },
          data: { matchedSize: live.sizeMatched, status: nextStatus },
        });
        advanced = true;
      }
    }

    if (advanced || orderAggregateFullyMatched(trade.orders, trade.stake)) {
      const refreshed = await prisma.trade.findUniqueOrThrow({
        where: { id: trade.id },
        include: { orders: true },
      });
      if (orderAggregateFullyMatched(refreshed.orders, refreshed.stake)) {
        await settleMatchedTrade(refreshed.id);
      }
    }
  }
}

// Manual close: cancel any unmatched legs, stamp exitReason + closedAt, emit
// trade:close. Used by the tick-loop's session stop and (later) the M3 risk
// module for stop-loss / forced-exit.
//
// Does NOT place a greening order here — that decision depends on risk
// context and belongs in M3. This function just cancels unmatched and locks
// the trade's final bookkeeping.
export async function closeTrade(
  client: BetAngelClient,
  tradeId: string,
  reason: "profit" | "stop_loss" | "forced_exit"
): Promise<Trade> {
  const trade = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { orders: true },
  });
  if (trade.status !== "open") return trade;

  // Cancel any executable (unmatched-or-partial) orders. Best-effort — a
  // failure to cancel (e.g. order already matched or network blip) is
  // swallowed; order status is re-queried so our DB view converges.
  for (const order of trade.orders) {
    if (order.status !== "unmatched") continue;
    if (!order.betAngelBetId) continue;
    try {
      const result = await client.cancelOrder(order.betAngelBetId);
      await prisma.tradeOrder.update({
        where: { id: order.id },
        data: { status: result.status === "SUCCESS" ? "cancelled" : order.status },
      });
    } catch {
      /* ignore — next tickOpenTrades will re-sync status */
    }
  }

  const newStatus: "matched" | "stopped" | "forced_exit" =
    reason === "profit" ? "matched" : reason === "stop_loss" ? "stopped" : "forced_exit";

  const closed = await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: newStatus,
      exitReason: reason,
      closedAt: new Date(),
      profitLoss: await computePnL(tradeId),
    },
    include: { orders: true },
  });

  tradingBus.emit("trade:close", {
    tradeId,
    marketId: closed.marketId,
    runnerId: closed.runnerId,
    status: newStatus,
    profitLoss: closed.profitLoss,
    exitReason: reason,
    at: Date.now(),
  });
  return closed;
}

// Flatten a trade: cancel unmatched legs, place a greening order against any
// remaining single-sided exposure, then stamp the final reason and P&L.
//
// Used by M3's stop-loss and pre-race forced-exit paths — whenever we need
// to close a potentially-imbalanced position NOW rather than wait for both
// entry legs to fill naturally. The greening order uses the current best
// opposite price (crossing placement), which fills immediately against a
// healthy book; stake is computed via `computeGreenUp` so the exposure
// nets out.
export async function flattenTrade(
  client: BetAngelClient,
  tradeId: string,
  reason: "stop_loss" | "forced_exit"
): Promise<Trade> {
  const trade = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { orders: true, market: true, runner: true },
  });
  if (trade.status !== "open") return trade;

  // 1. Cancel every unmatched (or partially-matched) entry leg.
  for (const order of trade.orders) {
    if (order.status !== "unmatched") continue;
    if (!order.betAngelBetId) continue;
    try {
      const result = await client.cancelOrder(order.betAngelBetId);
      await prisma.tradeOrder.update({
        where: { id: order.id },
        data: {
          status: result.status === "SUCCESS" ? "cancelled" : order.status,
          // If cancel succeeded, anything that didn't match is now cancelled.
        },
      });
    } catch {
      /* ignore — order state will re-sync on next tickOpenTrades */
    }
  }

  // 2. Compute net matched exposure after cancellations.
  const refreshed = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { orders: true, market: true, runner: true },
  });
  const matchedBack = refreshed.orders
    .filter((o) => o.side === "back" && o.purpose === "entry")
    .reduce((s, o) => s + o.matchedSize, 0);
  const matchedLay = refreshed.orders
    .filter((o) => o.side === "lay" && o.purpose === "entry")
    .reduce((s, o) => s + o.matchedSize, 0);

  // 3. If there's a net single-sided position, close it with a crossing
  //    order against the current best opposite price. computeGreenUp tells
  //    us what stake equalises the book.
  if (matchedBack !== matchedLay) {
    const prices = await client.getMarketPrices(refreshed.market.betfairMarketId);
    const rp = prices.runners.find((r) => r.selectionId === refreshed.runner.selectionId);
    const bestBack = rp?.availableToBack[0]?.price ?? null;
    const bestLay = rp?.availableToLay[0]?.price ?? null;

    if (rp && bestBack != null && bestLay != null) {
      // Determine net open side and its reference entry price (weighted avg
      // if multiple orders, but with symmetric scalp it's just the one).
      const openSide: "back" | "lay" = matchedBack > matchedLay ? "back" : "lay";
      const openStake = Math.abs(matchedBack - matchedLay);
      const entryOrder = refreshed.orders.find(
        (o) => o.side === openSide && o.purpose === "entry" && o.matchedSize > 0
      );
      const entryPrice = entryOrder?.price ?? (openSide === "back" ? refreshed.entryBackPrice : refreshed.entryLayPrice);
      const closingSide: "back" | "lay" = openSide === "back" ? "lay" : "back";
      const oppositePrice = closingSide === "lay" ? bestBack : bestLay;

      const quote = computeGreenUp(
        { side: openSide, stake: openStake, odds: entryPrice },
        oppositePrice
      );

      try {
        const closingResult = await client.placeOrder({
          marketId: refreshed.market.betfairMarketId,
          selectionId: refreshed.runner.selectionId,
          side: closingSide,
          price: oppositePrice,
          size: quote.closingStake,
          persistenceType: "LAPSE",
          customerOrderRef: `${refreshed.id}:flatten`,
        });
        await prisma.tradeOrder.create({
          data: {
            tradeId: refreshed.id,
            side: closingSide,
            purpose: reason === "stop_loss" ? "close" : "green",
            price: oppositePrice,
            size: quote.closingStake,
            matchedSize: closingResult.sizeMatched,
            status: closingResult.sizeRemaining === 0 && closingResult.sizeMatched > 0
              ? "matched"
              : closingResult.sizeMatched === 0 && closingResult.sizeRemaining === 0
                ? "cancelled"
                : "unmatched",
            betAngelBetId: closingResult.betId,
          },
        });
      } catch (err) {
        console.error("[oms] flatten placement failed", refreshed.id, err);
      }
    }
  }

  // 4. Stamp final trade state and emit event.
  const newStatus: "stopped" | "forced_exit" =
    reason === "stop_loss" ? "stopped" : "forced_exit";

  const closed = await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: newStatus,
      exitReason: reason,
      closedAt: new Date(),
      profitLoss: await computePnLIncludingClosing(tradeId),
    },
    include: { orders: true },
  });

  tradingBus.emit("trade:close", {
    tradeId,
    marketId: closed.marketId,
    runnerId: closed.runnerId,
    status: newStatus,
    profitLoss: closed.profitLoss,
    exitReason: reason,
    at: Date.now(),
  });
  return closed;
}

// ─── Internal helpers ────────────────────────────────────────────────────

function orderStatusFor(r: PlaceOrderResult): "unmatched" | "matched" | "cancelled" {
  if (r.sizeRemaining <= 0 && r.sizeMatched > 0) return "matched";
  if (r.sizeMatched > 0 && r.sizeRemaining > 0) return "unmatched"; // partial; still active
  if (r.sizeMatched === 0 && r.sizeRemaining === 0) return "cancelled";
  return "unmatched";
}

function mapExecutionStatus(
  s: "EXECUTABLE" | "EXECUTION_COMPLETE" | "CANCELLED"
): "unmatched" | "matched" | "cancelled" {
  if (s === "CANCELLED") return "cancelled";
  if (s === "EXECUTION_COMPLETE") return "matched";
  return "unmatched";
}

function bothLegsFullyMatched(back: PlaceOrderResult, lay: PlaceOrderResult, stake: number): boolean {
  return back.sizeMatched >= stake && lay.sizeMatched >= stake;
}

function orderAggregateFullyMatched(
  orders: Array<{ side: string; matchedSize: number; purpose: string }>,
  stake: number
): boolean {
  const back = orders.find((o) => o.side === "back" && o.purpose === "entry");
  const lay = orders.find((o) => o.side === "lay" && o.purpose === "entry");
  return !!back && !!lay && back.matchedSize >= stake && lay.matchedSize >= stake;
}

async function settleMatchedTrade(tradeId: string): Promise<void> {
  const profitLoss = await computePnL(tradeId);
  const closed = await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: "matched",
      exitReason: "profit",
      closedAt: new Date(),
      profitLoss,
    },
  });
  tradingBus.emit("trade:close", {
    tradeId,
    marketId: closed.marketId,
    runnerId: closed.runnerId,
    status: "matched",
    profitLoss,
    exitReason: "profit",
    at: Date.now(),
  });
}

// P&L for a scalped trade with symmetric stakes:
//   win  branch: stake*(backPrice - 1) - stake*(layPrice - 1) = stake*(backPrice - layPrice)
//   lose branch: -stake + stake = 0
// We take the branch minimum — matches greening.ts's "guaranteed floor"
// convention, so trade.profitLoss is never optimistic about one branch. If a
// leg cancelled without matching, we count only the matched side (still
// conservative because it represents an open/one-sided position at the
// moment of close).
async function computePnL(tradeId: string): Promise<number> {
  const trade = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { orders: true },
  });
  const back = trade.orders.find((o) => o.side === "back" && o.purpose === "entry");
  const lay = trade.orders.find((o) => o.side === "lay" && o.purpose === "entry");
  if (!back || !lay) return 0;
  const backFilled = back.matchedSize;
  const layFilled = lay.matchedSize;
  // Win branch: backFilled * (backPrice - 1) - layFilled * (layPrice - 1)
  // Lose branch: layFilled - backFilled
  const ifWin = backFilled * (back.price - 1) - layFilled * (lay.price - 1);
  const ifLose = layFilled - backFilled;
  return Math.min(ifWin, ifLose);
}

// Same branch-minimum convention as computePnL, but sums across ALL orders
// on the trade (entry + close + green). Used when a trade was flattened and
// a closing/greening leg was added — we need its contribution included.
async function computePnLIncludingClosing(tradeId: string): Promise<number> {
  const trade = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { orders: true },
  });
  let ifWin = 0;
  let ifLose = 0;
  for (const o of trade.orders) {
    if (o.matchedSize <= 0) continue;
    if (o.side === "back") {
      ifWin += o.matchedSize * (o.price - 1);
      ifLose += -o.matchedSize;
    } else {
      ifWin += -o.matchedSize * (o.price - 1);
      ifLose += o.matchedSize;
    }
  }
  return Math.min(ifWin, ifLose);
}
