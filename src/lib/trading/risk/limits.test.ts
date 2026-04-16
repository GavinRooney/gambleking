import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import {
  checkLayLiability,
  checkSessionSuspended,
  checkStakeLimit,
  tickDailyLossLimit,
} from "./limits";
import { updateStrategyConfig } from "../strategy-config";
import { tradingBus } from "../events";
import { openTrade } from "../engine/oms";
import { resetBetAngelClientCache } from "../bet-angel";
import { resetRunnerHistory } from "../engine/runner-selector";

const NOW = new Date("2026-04-16T14:30:00Z");

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
  await prisma.strategyConfig.deleteMany({});
}

async function makeSession(opts?: { dailyPnL?: number; suspended?: boolean }) {
  return prisma.tradingSession.create({
    data: {
      date: NOW,
      mode: "mock",
      startedAt: NOW,
      dailyPnL: opts?.dailyPnL ?? 0,
      suspendedAt: opts?.suspended ? NOW : null,
    },
  });
}

async function makeTradableRunner(client: MockBetAngelClient) {
  client.addMarket({
    marketId: "mock-1.limits",
    marketName: "Test",
    eventName: "Test",
    startTime: new Date(NOW.getTime() + 30 * 60_000),
    country: "GB",
    raceType: "flat",
    runners: [{ selectionId: 1, name: "Horse", initialPrice: 3.0 }],
  });
  client.getMarket("mock-1.limits")!.totalMatched = 100_000;
  const m = await prisma.tradingMarket.create({
    data: {
      betfairMarketId: "mock-1.limits",
      name: "Test",
      startTime: new Date(NOW.getTime() + 30 * 60_000),
      totalMatched: 100_000,
      numRunners: 1,
      status: "scanning",
    },
  });
  return prisma.tradingRunner.create({
    data: { marketId: m.id, selectionId: 1, horseName: "Horse" },
  });
}

beforeEach(async () => {
  await resetDb();
  resetRunnerHistory();
  resetBetAngelClientCache();
  tradingBus.removeAllListeners();
  process.env.BET_ANGEL_MODE = "mock";
  // PRD defaults; each test can override.
  await updateStrategyConfig({
    maxStakePerTrade: 200,
    dailyLossLimit: 200,
    maxLayLiability: 500,
  });
});

afterEach(() => {
  tradingBus.removeAllListeners();
});

describe("checkStakeLimit", () => {
  it("allows stakes at or below maxStakePerTrade", async () => {
    expect(await checkStakeLimit(50)).toEqual({ blocked: false });
    expect(await checkStakeLimit(200)).toEqual({ blocked: false });
  });

  it("blocks stakes above maxStakePerTrade with a descriptive reason", async () => {
    const result = await checkStakeLimit(201);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/exceeds maxStakePerTrade/);
  });
});

describe("checkLayLiability", () => {
  it("allows a lay with liability at or below the cap", async () => {
    // (3.0 - 1) × 50 = £100 liability
    expect(await checkLayLiability(3.0, 50)).toEqual({ blocked: false });
    // (11.0 - 1) × 50 = £500 (exactly at cap)
    expect(await checkLayLiability(11.0, 50)).toEqual({ blocked: false });
  });

  it("blocks a lay whose liability exceeds maxLayLiability", async () => {
    // (11.01 - 1) × 50 = £500.50
    const result = await checkLayLiability(11.01, 50);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/exceeds maxLayLiability/);
  });

  it("catches the accidental high-odds scenario (lay at 50.0 with £50)", async () => {
    // (50 - 1) × 50 = £2450 — way over 500
    const result = await checkLayLiability(50.0, 50);
    expect(result.blocked).toBe(true);
  });
});

describe("checkSessionSuspended", () => {
  it("passes an active session", async () => {
    const s = await makeSession();
    expect(await checkSessionSuspended(s.id)).toEqual({ blocked: false });
  });

  it("blocks a suspended session", async () => {
    const s = await makeSession({ suspended: true });
    const result = await checkSessionSuspended(s.id);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/suspended at/);
  });

  it("blocks an unknown session id", async () => {
    const result = await checkSessionSuspended("no-such-session");
    expect(result.blocked).toBe(true);
  });
});

describe("tickDailyLossLimit — session suspension", () => {
  it("does nothing when dailyPnL is above the loss cap", async () => {
    const s = await makeSession({ dailyPnL: -150 }); // above -200
    const suspended = await tickDailyLossLimit(s.id);
    expect(suspended).toBe(false);
    const refreshed = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(refreshed.suspendedAt).toBeNull();
  });

  it("suspends the session when dailyPnL reaches -dailyLossLimit", async () => {
    const s = await makeSession({ dailyPnL: -200 });
    const suspended = await tickDailyLossLimit(s.id);
    expect(suspended).toBe(true);
    const refreshed = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(refreshed.suspendedAt).not.toBeNull();
  });

  it("suspends the session when dailyPnL exceeds -dailyLossLimit (worse)", async () => {
    const s = await makeSession({ dailyPnL: -350 });
    const suspended = await tickDailyLossLimit(s.id);
    expect(suspended).toBe(true);
  });

  it("is idempotent — does not re-stamp an already-suspended session", async () => {
    const s = await makeSession({ dailyPnL: -300, suspended: true });
    const original = (await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).suspendedAt;
    const suspended = await tickDailyLossLimit(s.id);
    expect(suspended).toBe(false);
    const after = (await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).suspendedAt;
    expect(after).toEqual(original);
  });

  it("emits session:update with suspended=true when it fires", async () => {
    const s = await makeSession({ dailyPnL: -250 });
    const seen: boolean[] = [];
    tradingBus.on("session:update", (p) => seen.push(p.suspended));
    await tickDailyLossLimit(s.id);
    expect(seen).toEqual([true]);
  });
});

describe("openTrade — limit enforcement", () => {
  it("refuses to open when the session is suspended", async () => {
    const client = new MockBetAngelClient({ seed: 3 });
    const runner = await makeTradableRunner(client);
    const session = await makeSession({ suspended: true });
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 50,
      maxConcurrentPerMarket: 5,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/suspended/);
  });

  it("refuses to open when the requested stake exceeds maxStakePerTrade", async () => {
    const client = new MockBetAngelClient({ seed: 3 });
    const runner = await makeTradableRunner(client);
    const session = await makeSession();
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 500, // well over default 200
      maxConcurrentPerMarket: 5,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/exceeds maxStakePerTrade/);
  });

  it("refuses to open when the lay-leg liability would exceed maxLayLiability", async () => {
    const client = new MockBetAngelClient({ seed: 3 });
    // Runner with initialPrice 50 — at that odds, even a £15 stake gives
    // a lay liability of (50-1)*15 = £735, above the default £500 cap.
    client.addMarket({
      marketId: "mock-1.longshot",
      marketName: "Longshot",
      eventName: "Test",
      startTime: new Date(NOW.getTime() + 30 * 60_000),
      country: "GB",
      raceType: "flat",
      runners: [{ selectionId: 99, name: "Longshot", initialPrice: 50.0 }],
    });
    client.getMarket("mock-1.longshot")!.totalMatched = 100_000;
    const m = await prisma.tradingMarket.create({
      data: {
        betfairMarketId: "mock-1.longshot",
        name: "Longshot",
        startTime: new Date(NOW.getTime() + 30 * 60_000),
        totalMatched: 100_000,
        numRunners: 1,
        status: "scanning",
      },
    });
    const runner = await prisma.tradingRunner.create({
      data: { marketId: m.id, selectionId: 99, horseName: "Longshot" },
    });
    const session = await makeSession();
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 15,
      maxConcurrentPerMarket: 5,
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/maxLayLiability/);
  });
});
