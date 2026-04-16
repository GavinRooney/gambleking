import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  startSession,
  stopSession,
  getActiveSession,
  runTradingTick,
  DEFAULT_OPENING_THRESHOLDS,
} from "./session";
import { getBetAngelClient, resetBetAngelClientCache } from "../bet-angel";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { resetRunnerHistory } from "./runner-selector";
import { tradingBus } from "../events";

const ORIGINAL_ENV = { ...process.env };

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
}

function addStableMarket(client: MockBetAngelClient, id = "1.700") {
  const runners = Array.from({ length: 8 }, (_, i) => ({
    selectionId: i + 1,
    name: `Horse ${i + 1}`,
    initialPrice: 3.0 + i * 1.5,
  }));
  client.addMarket({
    marketId: id,
    marketName: `R1 ${id}`,
    eventName: `14:30 Ascot`,
    startTime: new Date(Date.now() + 30 * 60_000),
    country: "GB",
    raceType: "flat",
    scenario: "stable",
    runners,
  });
  client.getMarket(id)!.totalMatched = 100_000;
}

beforeEach(async () => {
  // Start from a totally clean slate — DB, selector history, factory cache,
  // and the active-session global. Without the active-session reset, a stray
  // session from a prior test can keep the event listeners attached.
  (globalThis as unknown as { activeTradingSession: null | unknown }).activeTradingSession = null;
  resetBetAngelClientCache();
  resetRunnerHistory();
  tradingBus.removeAllListeners();
  // Restore env from a clean snapshot, then pin mock mode.
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
  process.env.BET_ANGEL_MODE = "mock";
  await resetDb();
});

afterEach(async () => {
  // Make sure no session leaks between tests.
  await stopSession();
});

describe("session — lifecycle", () => {
  it("startSession creates a row, emits session:update, and stamps mode", async () => {
    const updates: number[] = [];
    tradingBus.on("session:update", (p) => updates.push(p.tradesOpened));

    const session = await startSession({ intervalMs: 0 }); // suppress auto-tick
    expect(session.mode).toBe("mock");
    expect(session.endedAt).toBeNull();
    expect(updates.length).toBeGreaterThanOrEqual(1);

    const active = await getActiveSession();
    expect(active?.id).toBe(session.id);
  });

  it("refuses to start a second session concurrently", async () => {
    await startSession({ intervalMs: 0 });
    await expect(startSession({ intervalMs: 0 })).rejects.toThrow(/already active/);
  });

  it("stopSession stamps endedAt and clears the active state", async () => {
    const started = await startSession({ intervalMs: 0 });
    const stopped = await stopSession();
    expect(stopped?.id).toBe(started.id);
    expect(stopped?.endedAt).not.toBeNull();
    expect(await getActiveSession()).toBeNull();
  });
});

describe("session — end-to-end against mock", () => {
  it("opens, matches, and closes scalp trades over a handful of ticks", async () => {
    const client = getBetAngelClient();
    expect(client).toBeInstanceOf(MockBetAngelClient);
    addStableMarket(client as MockBetAngelClient);

    const session = await startSession({ intervalMs: 0 });

    // 60 ticks at simulated 500ms cadence — enough for the rolling-volatility
    // window to fill and for the tick-loop to open + settle multiple trades.
    for (let i = 0; i < 60; i++) {
      await runTradingTick(client, {
        now: new Date(session.startedAt.getTime() + i * 500),
      });
    }

    const trades = await prisma.trade.findMany({ where: { sessionId: session.id } });
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.mode === "mock")).toBe(true);
    // Most/all trades should be terminally closed (crossing placement fills
    // on placement against the mock's synthetic book).
    const closedCount = trades.filter((t) => t.status !== "open").length;
    expect(closedCount).toBeGreaterThan(0);
  });

  it("updates session stats in response to trade events", async () => {
    const client = getBetAngelClient();
    addStableMarket(client as MockBetAngelClient);
    const session = await startSession({ intervalMs: 0 });

    for (let i = 0; i < 60; i++) {
      await runTradingTick(client, {
        now: new Date(session.startedAt.getTime() + i * 500),
      });
    }

    const refreshed = await prisma.tradingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshed.tradesOpened).toBeGreaterThan(0);
    expect(refreshed.tradesClosed).toBeGreaterThan(0);
    // Crossing placement into mock's symmetric book nets ≥ 0 on the win
    // branch; dailyPnL should be non-negative.
    expect(refreshed.dailyPnL).toBeGreaterThanOrEqual(0);
  });

  it("force-closes any lingering open trades on stopSession", async () => {
    const client = getBetAngelClient();
    addStableMarket(client as MockBetAngelClient);
    const session = await startSession({ intervalMs: 0 });

    // Manually inject an open trade that the session's tick loop never
    // touches — simulates a trade whose legs haven't yet settled when the
    // user hits stop.
    const runner = await prisma.tradingRunner.findFirst();
    if (!runner) {
      // Need to have seeded at least one runner, so first run a tick.
      await runTradingTick(client, { now: session.startedAt });
    }
    const r = await prisma.tradingRunner.findFirstOrThrow();
    await prisma.trade.create({
      data: {
        sessionId: session.id,
        marketId: r.marketId,
        runnerId: r.id,
        entryBackPrice: 3.05,
        entryLayPrice: 2.95,
        stake: 10,
        status: "open",
        mode: "mock",
      },
    });

    await stopSession();

    const lingering = await prisma.trade.findMany({
      where: { sessionId: session.id, status: "open" },
    });
    expect(lingering).toHaveLength(0);
    const forcedExits = await prisma.trade.findMany({
      where: { sessionId: session.id, exitReason: "forced_exit" },
    });
    expect(forcedExits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("session — opening decision thresholds", () => {
  it("does not open trades when the threshold makes every runner ineligible", async () => {
    const client = getBetAngelClient() as MockBetAngelClient;
    addStableMarket(client, "1.800");
    const session = await startSession({ intervalMs: 0 });

    // A negative volatility threshold is unreachable — stddev ≥ 0 always.
    // This proves the filter is actually gating trade creation rather than
    // every tick blindly opening. (Relying on the drifting scenario to
    // produce high volatility is fragile at coarse ticks — best-back can
    // stay pinned at one level for many ticks if drift < tick size.)
    for (let i = 0; i < 60; i++) {
      await runTradingTick(client, {
        now: new Date(session.startedAt.getTime() + i * 500),
        thresholds: { ...DEFAULT_OPENING_THRESHOLDS, maxVolatilityScore: -1 },
      });
    }

    const trades = await prisma.trade.findMany({ where: { sessionId: session.id } });
    expect(trades.length).toBe(0);
  });

  it("opens trades with default thresholds on a stable market — baseline sanity", async () => {
    const client = getBetAngelClient() as MockBetAngelClient;
    addStableMarket(client, "1.801");
    const session = await startSession({ intervalMs: 0 });
    for (let i = 0; i < 60; i++) {
      await runTradingTick(client, {
        now: new Date(session.startedAt.getTime() + i * 500),
      });
    }
    const trades = await prisma.trade.findMany({ where: { sessionId: session.id } });
    expect(trades.length).toBeGreaterThan(0);
  });
});
