// TradingSession lifecycle + the engine tick loop.
//
// At most one session is active at a time. startSession() creates the DB row
// and starts a setInterval that runs runTradingTick() every 500 ms:
//
//   tick = step mock (if mock mode) → scan markets → select runners
//        → open qualifying trades → tick open trades
//
// stopSession() clears the interval, force-closes any open trades, and
// stamps endedAt.
//
// Trade events (trade:open, trade:close) are emitted by the OMS. The session
// listens to those events and incrementally updates its DB row + emits
// session:update so the UI (SSE) doesn't need to poll.

import { prisma } from "@/lib/db";
import type { TradingSession } from "@/generated/prisma/client";
import type { BetAngelClient } from "../bet-angel/client";
import { getBetAngelClient, getBetAngelMode } from "../bet-angel";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { tradingBus } from "../events";
import { getStrategyConfig } from "../strategy-config";
import {
  scanMarkets,
  DEFAULT_SCANNER_CONFIG,
  type ScannerConfig,
} from "./market-scanner";
import { selectRunners, type RunnerSignals } from "./runner-selector";
import { closeTrade, openTrade, tickOpenTrades } from "./oms";
import { tickStopLoss } from "../risk/stop-loss";
import { tickPreRaceExit } from "../risk/pre-race-exit";
import { tickDailyLossLimit } from "../risk/limits";
import { tickConnectionFailsafe } from "../risk/connection-failsafe";

export const DEFAULT_TICK_INTERVAL_MS = 500;

// Thresholds used by the tick loop to pick scalp candidates. MVP defaults;
// tune in M5a against real practice-mode data.
export type OpeningThresholds = {
  // Max stddev of best-back price over the 30 s window. Lower = more stable.
  // The mock's stable scenario sits well below 0.05 after the window fills.
  maxVolatilityScore: number;
  // Book-balance bounds per PRD §2.3.
  minBookBalance: number;
  maxBookBalance: number;
  // Traded-volume rank cap (0-indexed, inclusive). Top-N most-traded runners.
  maxTradedVolumeRank: number;
};

export const DEFAULT_OPENING_THRESHOLDS: OpeningThresholds = {
  maxVolatilityScore: 0.05,
  minBookBalance: 0.7,
  maxBookBalance: 1.3,
  maxTradedVolumeRank: 2,
};

export type TickOptions = {
  scannerConfig?: ScannerConfig;
  thresholds?: OpeningThresholds;
  now?: Date;
};

// ─── Session lifecycle ───────────────────────────────────────────────────

type ActiveState = {
  sessionId: string;
  handle: NodeJS.Timeout | null;
  busUnsubscribe: () => void;
};

const globalForSession = globalThis as unknown as {
  activeTradingSession: ActiveState | null | undefined;
};
if (globalForSession.activeTradingSession === undefined) {
  globalForSession.activeTradingSession = null;
}

export async function getActiveSession(): Promise<TradingSession | null> {
  const state = globalForSession.activeTradingSession;
  if (!state) return null;
  return prisma.tradingSession.findUnique({ where: { id: state.sessionId } });
}

export async function startSession(opts?: { intervalMs?: number }): Promise<TradingSession> {
  if (globalForSession.activeTradingSession) {
    throw new Error("A trading session is already active — call stopSession() first");
  }
  const mode = getBetAngelMode();
  const now = new Date();
  const session = await prisma.tradingSession.create({
    data: { date: new Date(now.getFullYear(), now.getMonth(), now.getDate()), mode, startedAt: now },
  });

  const client = getBetAngelClient();
  const busUnsubscribe = wireSessionStatsTracking(session.id);

  const handle =
    opts?.intervalMs === 0
      ? null
      : setInterval(() => {
          runTradingTick(client).catch((err) => {
            console.error("[engine] tick error", err);
          });
        }, opts?.intervalMs ?? DEFAULT_TICK_INTERVAL_MS);

  globalForSession.activeTradingSession = { sessionId: session.id, handle, busUnsubscribe };
  emitSessionUpdate(session);
  return session;
}

export async function stopSession(): Promise<TradingSession | null> {
  const state = globalForSession.activeTradingSession;
  if (!state) return null;

  if (state.handle) clearInterval(state.handle);
  state.busUnsubscribe();
  globalForSession.activeTradingSession = null;

  // Force-close any still-open trades. They won't see any more ticks and
  // the UI shouldn't show them as live.
  const client = getBetAngelClient();
  const openTrades = await prisma.trade.findMany({
    where: { sessionId: state.sessionId, status: "open" },
  });
  for (const trade of openTrades) {
    try {
      await closeTrade(client, trade.id, "forced_exit");
    } catch (err) {
      console.error("[engine] failed to force-close trade", trade.id, err);
    }
  }

  const closed = await prisma.tradingSession.update({
    where: { id: state.sessionId },
    data: { endedAt: new Date() },
  });
  emitSessionUpdate(closed);
  return closed;
}

// ─── Tick loop ───────────────────────────────────────────────────────────

// Drive one tick. Exported and async so tests can await it step-by-step
// rather than leaning on the setInterval. The mock is also stepped here so
// mock-mode sessions see market evolution in lock-step with the engine.
export async function runTradingTick(
  client: BetAngelClient,
  opts: TickOptions = {}
): Promise<void> {
  const now = opts.now ?? new Date();

  if (client instanceof MockBetAngelClient) client.step();

  // Run the connection failsafe first — if the client is unreachable the
  // rest of the tick will fail downstream anyway, but we want the outage
  // state tracked regardless.
  await tickConnectionFailsafe(client, now);

  await scanMarkets(client, opts.scannerConfig ?? DEFAULT_SCANNER_CONFIG, now);
  const selection = await selectRunners(client, undefined, now);

  // Pre-race exit runs BEFORE opening decisions so newly-warned markets
  // are filtered out this tick rather than next. It also flattens any
  // trades in markets that have crossed the hard-exit threshold.
  await tickPreRaceExit(client, now);

  const session = globalForSession.activeTradingSession;
  if (session) {
    // Daily loss limit: stamps suspendedAt on the session if breached. The
    // openTrade call in applyOpeningDecisions then reads the flag and
    // refuses new trades — but running the check here makes the suspension
    // visible to the UI on the same tick.
    await tickDailyLossLimit(session.sessionId);
    await applyOpeningDecisions(client, session.sessionId, selection.markets, opts.thresholds);
  }

  // Stop-loss must fire BEFORE tickOpenTrades so that a trade hitting the
  // threshold gets flattened this tick rather than waiting for both legs
  // to match naturally (they won't).
  await tickStopLoss(client);
  await tickOpenTrades(client);
}

async function applyOpeningDecisions(
  client: BetAngelClient,
  sessionId: string,
  markets: Array<{ marketId: string; runners: RunnerSignals[] }>,
  thresholdsOverride?: OpeningThresholds
): Promise<void> {
  const thresholds = thresholdsOverride ?? DEFAULT_OPENING_THRESHOLDS;
  const strategyConfig = await getStrategyConfig();

  for (const market of markets) {
    for (const runner of market.runners) {
      if (!isScalpCandidate(runner, thresholds)) continue;
      // Skip runners where we already have an open trade, so a single tick
      // pass doesn't double-up.
      const existing = await prisma.trade.count({
        where: { runnerId: runner.runnerId, status: "open" },
      });
      if (existing > 0) continue;

      await openTrade(client, {
        sessionId,
        runnerId: runner.runnerId,
        stake: strategyConfig.scalpStake,
        maxConcurrentPerMarket: strategyConfig.maxConcurrentTrades,
      });
    }
  }
}

function isScalpCandidate(r: RunnerSignals, t: OpeningThresholds): boolean {
  if (r.volatilityScore == null) return false;
  if (r.volatilityScore > t.maxVolatilityScore) return false;
  if (r.bookBalance == null) return false;
  if (r.bookBalance < t.minBookBalance || r.bookBalance > t.maxBookBalance) return false;
  if (r.tradedVolumeRank > t.maxTradedVolumeRank) return false;
  return true;
}

// ─── Session stats tracking (event-driven) ──────────────────────────────

function wireSessionStatsTracking(sessionId: string): () => void {
  const offOpen = tradingBus.on("trade:open", async (p) => {
    const s = globalForSession.activeTradingSession;
    if (!s || s.sessionId !== sessionId) return;
    const updated = await prisma.tradingSession.update({
      where: { id: sessionId },
      data: { tradesOpened: { increment: 1 } },
    });
    emitSessionUpdate(updated);
    void p;
  });

  const offClose = tradingBus.on("trade:close", async (p) => {
    const s = globalForSession.activeTradingSession;
    if (!s || s.sessionId !== sessionId) return;
    const updated = await prisma.tradingSession.update({
      where: { id: sessionId },
      data: {
        tradesClosed: { increment: 1 },
        dailyPnL: { increment: p.profitLoss },
      },
    });
    emitSessionUpdate(updated);
  });

  return () => {
    offOpen();
    offClose();
  };
}

function emitSessionUpdate(s: TradingSession): void {
  tradingBus.emit("session:update", {
    sessionId: s.id,
    dailyPnL: s.dailyPnL,
    tradesOpened: s.tradesOpened,
    tradesClosed: s.tradesClosed,
    suspended: s.suspendedAt !== null,
    at: Date.now(),
  });
}
