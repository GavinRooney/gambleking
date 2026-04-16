// Risk limits — PRD §7.3–7.4.
//
// Three non-bypassable checks invoked from OMS.openTrade before a new trade
// is placed. The tick loop also calls tickDailyLossLimit() which stamps
// session.suspendedAt once the loss cap is breached — from that point,
// openTrade refuses via checkSessionSuspended.
//
//   checkDailyLossLimit(sessionId)  — session-level guard (one-shot: once
//                                      suspended, stays suspended until
//                                      stopSession / next session)
//   checkStakeLimit(stake)          — per-trade guard (nominal stake cap)
//   checkLayLiability(price, stake) — per-trade guard on the lay-leg liability
//                                     (price - 1) × stake; catches accidental
//                                     high-odds layings
//
// checkLayLiability is applied to the ENTRY lay leg in openTrade only. It is
// deliberately NOT applied to the closing/greening leg in flattenTrade: once
// a position is open we have to close it regardless, and blocking the rescue
// order would strand us with live exposure.

import { prisma } from "@/lib/db";
import { tradingBus } from "../events";
import { getStrategyConfig } from "../strategy-config";

export type LimitCheck = { blocked: false } | { blocked: true; reason: string };

// Per-trade stake cap. Reject orders that would exceed maxStakePerTrade.
export async function checkStakeLimit(stake: number): Promise<LimitCheck> {
  const config = await getStrategyConfig();
  if (stake > config.maxStakePerTrade) {
    return {
      blocked: true,
      reason: `stake £${stake} exceeds maxStakePerTrade £${config.maxStakePerTrade}`,
    };
  }
  return { blocked: false };
}

// Liability check on a prospective lay leg. Liability at match time is
// (price - 1) × stake — what the layer stands to pay out if the horse wins.
// Reject when it exceeds maxLayLiability.
export async function checkLayLiability(
  layPrice: number,
  stake: number
): Promise<LimitCheck> {
  const config = await getStrategyConfig();
  const liability = (layPrice - 1) * stake;
  if (liability > config.maxLayLiability) {
    return {
      blocked: true,
      reason: `lay liability £${liability.toFixed(2)} (${layPrice} × £${stake}) exceeds maxLayLiability £${config.maxLayLiability}`,
    };
  }
  return { blocked: false };
}

// Fast check used by openTrade: is the given session currently suspended?
// If dailyPnL has crossed -dailyLossLimit the tickDailyLossLimit function
// will have stamped suspendedAt; this just reads the flag.
export async function checkSessionSuspended(
  sessionId: string
): Promise<LimitCheck> {
  const session = await prisma.tradingSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return { blocked: true, reason: `session ${sessionId} not found` };
  }
  if (session.suspendedAt !== null) {
    return {
      blocked: true,
      reason: `session suspended at ${session.suspendedAt.toISOString()}`,
    };
  }
  return { blocked: false };
}

// Tick-loop driven: stamp suspendedAt on the active session if its running
// dailyPnL has dropped to or below -dailyLossLimit. Idempotent — a session
// already suspended is not re-stamped.
export async function tickDailyLossLimit(sessionId: string): Promise<boolean> {
  const session = await prisma.tradingSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.suspendedAt !== null) return false;

  const config = await getStrategyConfig();
  // Daily loss limit is expressed as a positive number (£200 default) but
  // represents the maximum allowable LOSS. Suspension fires when the running
  // dailyPnL reaches -dailyLossLimit or worse.
  if (session.dailyPnL > -config.dailyLossLimit) return false;

  const suspended = await prisma.tradingSession.update({
    where: { id: sessionId },
    data: { suspendedAt: new Date() },
  });
  tradingBus.emit("session:update", {
    sessionId: suspended.id,
    dailyPnL: suspended.dailyPnL,
    tradesOpened: suspended.tradesOpened,
    tradesClosed: suspended.tradesClosed,
    suspended: true,
    at: Date.now(),
  });
  return true;
}
