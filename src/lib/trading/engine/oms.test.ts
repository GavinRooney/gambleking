import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { scanMarkets, DEFAULT_SCANNER_CONFIG } from "./market-scanner";
import { selectRunners, resetRunnerHistory } from "./runner-selector";
import { openTrade, tickOpenTrades, closeTrade } from "./oms";
import { tradingBus } from "../events";

const NOW0 = new Date("2026-04-16T12:00:00Z");

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
}

async function createSession(mode: "mock" | "practice" | "live" = "mock") {
  return prisma.tradingSession.create({
    data: { date: NOW0, mode, startedAt: NOW0 },
  });
}

function seedClient(seed = 7): MockBetAngelClient {
  const client = new MockBetAngelClient({ seed });
  // Needs ≥6 runners to pass scanner's minRunners filter.
  client.addMarket({
    marketId: "1.500",
    marketName: "R1 Hcap",
    eventName: "14:30 Ascot",
    startTime: new Date(NOW0.getTime() + 30 * 60_000),
    country: "GB",
    raceType: "flat",
    runners: [
      { selectionId: 1, name: "Horse A", initialPrice: 3.0 },
      { selectionId: 2, name: "Horse B", initialPrice: 5.0 },
      { selectionId: 3, name: "Horse C", initialPrice: 7.0 },
      { selectionId: 4, name: "Horse D", initialPrice: 9.0 },
      { selectionId: 5, name: "Horse E", initialPrice: 12.0 },
      { selectionId: 6, name: "Horse F", initialPrice: 17.0 },
      { selectionId: 7, name: "Horse G", initialPrice: 25.0 },
      { selectionId: 8, name: "Horse H", initialPrice: 40.0 },
    ],
  });
  client.getMarket("1.500")!.totalMatched = 100_000;
  return client;
}

async function seedRunnerRow(client: MockBetAngelClient) {
  await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW0);
  await selectRunners(client, undefined, NOW0);
  const runner = await prisma.tradingRunner.findFirstOrThrow({
    where: { selectionId: 1 },
  });
  return runner;
}

beforeEach(async () => {
  await resetDb();
  resetRunnerHistory();
  tradingBus.removeAllListeners();
  // Ensure mock mode is active — affects Trade.mode stamping.
  process.env.BET_ANGEL_MODE = "mock";
});

afterEach(() => {
  tradingBus.removeAllListeners();
});

describe("OMS — openTrade", () => {
  it("places paired back+lay orders and persists a Trade + two TradeOrder rows", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });

    expect(result.status).toBe("opened");
    if (result.status !== "opened") throw new Error("unreachable");

    // Against the mock's synthetic liquidity the paired crossing orders match
    // immediately — so the trade should be closed at profit on the same call.
    expect(result.trade.status).toBe("matched");
    expect(result.trade.exitReason).toBe("profit");
    expect(result.trade.closedAt).not.toBeNull();

    // Stake rounding note: scalp places back at best-lay (high) and lay at
    // best-back (low), so profit on the win branch is stake * spread > 0.
    expect(result.trade.profitLoss).toBeGreaterThanOrEqual(0);

    const orders = await prisma.tradeOrder.findMany({ where: { tradeId: result.trade.id } });
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.side).sort()).toEqual(["back", "lay"]);
    expect(orders.every((o) => o.status === "matched")).toBe(true);
  });

  it("stamps Trade.mode from BET_ANGEL_MODE at placement time", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    if (result.status !== "opened") throw new Error("unreachable");
    expect(result.trade.mode).toBe("mock");
  });

  it("links the trade to its session", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    if (result.status !== "opened") throw new Error("unreachable");
    expect(result.trade.sessionId).toBe(session.id);
  });

  it("emits trade:open and trade:close events for a matched-on-entry trade", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);
    const seen: string[] = [];
    tradingBus.on("trade:open", () => seen.push("open"));
    tradingBus.on("trade:close", () => seen.push("close"));

    await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    // Order matters: open must always precede close.
    expect(seen).toEqual(["open", "close"]);
  });

  it("refuses to open when maxConcurrentPerMarket is exceeded", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    // Manually insert two open trades so the cap is already hit. Use createMany
    // so we don't go through openTrade (which auto-closes via the mock).
    await prisma.trade.createMany({
      data: [
        {
          sessionId: session.id,
          marketId: runner.marketId,
          runnerId: runner.id,
          entryBackPrice: 3.05,
          entryLayPrice: 2.95,
          stake: 10,
          status: "open",
          mode: "mock",
        },
        {
          sessionId: session.id,
          marketId: runner.marketId,
          runnerId: runner.id,
          entryBackPrice: 3.05,
          entryLayPrice: 2.95,
          stake: 10,
          status: "open",
          mode: "mock",
        },
      ],
    });

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 2,
    });
    expect(result.status).toBe("skipped");
  });

  it("skips when runner is missing or inactive", async () => {
    const client = seedClient();
    const session = await createSession();
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: "nonexistent",
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    expect(result.status).toBe("skipped");
  });
});

describe("OMS — tickOpenTrades", () => {
  it("promotes an unmatched trade to matched once both legs settle", async () => {
    // Force a resting pair by placing both legs at non-crossing prices. The
    // openTrade helper always uses aggressive placement, so we simulate a
    // rested trade by constructing it manually.
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    // Manually place two crossing orders so we have betAngelBetIds to poll.
    const prices = await client.getMarketPrices("1.500");
    const rp = prices.runners.find((r) => r.selectionId === 1)!;
    const back = await client.placeOrder({
      marketId: "1.500",
      selectionId: 1,
      side: "back",
      price: rp.availableToLay[0].price,
      size: 10,
    });
    const lay = await client.placeOrder({
      marketId: "1.500",
      selectionId: 1,
      side: "lay",
      price: rp.availableToBack[0].price,
      size: 10,
    });

    // Construct a Trade + two TradeOrder rows that are initially unmatched
    // in our DB, even though the mock has already matched them. tickOpenTrades
    // should sync the truth.
    const trade = await prisma.trade.create({
      data: {
        sessionId: session.id,
        marketId: runner.marketId,
        runnerId: runner.id,
        entryBackPrice: rp.availableToLay[0].price,
        entryLayPrice: rp.availableToBack[0].price,
        stake: 10,
        status: "open",
        mode: "mock",
      },
    });
    await prisma.tradeOrder.createMany({
      data: [
        {
          tradeId: trade.id,
          side: "back",
          purpose: "entry",
          price: rp.availableToLay[0].price,
          size: 10,
          matchedSize: 0,
          status: "unmatched",
          betAngelBetId: back.betId,
        },
        {
          tradeId: trade.id,
          side: "lay",
          purpose: "entry",
          price: rp.availableToBack[0].price,
          size: 10,
          matchedSize: 0,
          status: "unmatched",
          betAngelBetId: lay.betId,
        },
      ],
    });

    await tickOpenTrades(client);

    const refreshed = await prisma.trade.findUnique({ where: { id: trade.id } });
    expect(refreshed!.status).toBe("matched");
    expect(refreshed!.exitReason).toBe("profit");
    expect(refreshed!.closedAt).not.toBeNull();
  });

  it("is idempotent on already-closed trades", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    if (result.status !== "opened") throw new Error("unreachable");

    // Trade is already matched + closed. Re-ticking should be a safe no-op.
    await tickOpenTrades(client);
    await tickOpenTrades(client);

    const refreshed = await prisma.trade.findUnique({ where: { id: result.trade.id } });
    expect(refreshed!.status).toBe("matched");
  });
});

describe("OMS — closeTrade", () => {
  it("cancels unmatched orders and stamps forced-exit reason", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);

    // Place a single back order that rests (price well below best-lay so it
    // doesn't cross). We then manually construct an open trade around it.
    const below = 1.5; // well below any sensible synthetic best-lay
    const back = await client.placeOrder({
      marketId: "1.500",
      selectionId: 1,
      side: "back",
      price: below,
      size: 10,
    });
    expect(back.sizeMatched).toBe(0);

    const trade = await prisma.trade.create({
      data: {
        sessionId: session.id,
        marketId: runner.marketId,
        runnerId: runner.id,
        entryBackPrice: below,
        entryLayPrice: below,
        stake: 10,
        status: "open",
        mode: "mock",
      },
    });
    await prisma.tradeOrder.create({
      data: {
        tradeId: trade.id,
        side: "back",
        purpose: "entry",
        price: below,
        size: 10,
        matchedSize: 0,
        status: "unmatched",
        betAngelBetId: back.betId,
      },
    });

    const closed = await closeTrade(client, trade.id, "forced_exit");
    expect(closed.status).toBe("forced_exit");
    expect(closed.exitReason).toBe("forced_exit");
    expect(closed.closedAt).not.toBeNull();

    const orderRow = await prisma.tradeOrder.findFirstOrThrow({ where: { tradeId: trade.id } });
    expect(orderRow.status).toBe("cancelled");
  });

  it("is a no-op for trades already closed", async () => {
    const client = seedClient();
    const session = await createSession();
    const runner = await seedRunnerRow(client);
    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });
    if (result.status !== "opened") throw new Error("unreachable");

    const before = result.trade;
    const after = await closeTrade(client, before.id, "forced_exit");
    // Status should be unchanged (still matched).
    expect(after.status).toBe(before.status);
    expect(after.closedAt).toEqual(before.closedAt);
  });
});
