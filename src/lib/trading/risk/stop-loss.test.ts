import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { tickStopLoss } from "./stop-loss";
import { updateStrategyConfig } from "../strategy-config";
import { tradingBus } from "../events";
import { resetBetAngelClientCache } from "../bet-angel";
import { resetRunnerHistory } from "../engine/runner-selector";

const NOW0 = new Date("2026-04-16T12:00:00Z");

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
  await prisma.strategyConfig.deleteMany({});
}

// Build the DB state we need to test stop-loss. Directly inserts a
// TradingMarket + TradingRunner + Trade + TradeOrder rows so we can choose
// the exact one-leg-matched scenario without depending on the OMS entry
// path (which uses crossing placement that always double-matches).
//
// We do NOT place "resting" orders on the client for the unmatched leg —
// doing so would inject them into the mock's synthetic book (buildBook
// merges resting orders into availableToBack/availableToLay) and would
// make currentBestBack/currentBestLay wrong. flattenTrade's cancel step
// skips gracefully when betAngelBetId is absent.
async function seedOpenTrade(opts: {
  matchedLegSide: "back" | "lay";
  matchedLegPrice: number;
  otherLegPrice: number; // nominal price recorded on the unmatched leg row
}) {
  const m = await prisma.tradingMarket.create({
    data: {
      betfairMarketId: "mock-1.stop",
      name: "Stop-loss test",
      startTime: new Date(NOW0.getTime() + 30 * 60_000),
      totalMatched: 100_000,
      numRunners: 1,
      status: "trading",
    },
  });
  const r = await prisma.tradingRunner.create({
    data: { marketId: m.id, selectionId: 1, horseName: "Target" },
  });
  const trade = await prisma.trade.create({
    data: {
      marketId: m.id,
      runnerId: r.id,
      entryBackPrice: opts.matchedLegSide === "back" ? opts.matchedLegPrice : opts.otherLegPrice,
      entryLayPrice: opts.matchedLegSide === "lay" ? opts.matchedLegPrice : opts.otherLegPrice,
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
        price: opts.matchedLegSide === "back" ? opts.matchedLegPrice : opts.otherLegPrice,
        size: 10,
        matchedSize: opts.matchedLegSide === "back" ? 10 : 0,
        status: opts.matchedLegSide === "back" ? "matched" : "unmatched",
      },
      {
        tradeId: trade.id,
        side: "lay",
        purpose: "entry",
        price: opts.matchedLegSide === "lay" ? opts.matchedLegPrice : opts.otherLegPrice,
        size: 10,
        matchedSize: opts.matchedLegSide === "lay" ? 10 : 0,
        status: opts.matchedLegSide === "lay" ? "matched" : "unmatched",
      },
    ],
  });
  return { trade, market: m, runner: r };
}

function newMockWithRunner(truePrice: number): MockBetAngelClient {
  const client = new MockBetAngelClient({ seed: 11 });
  client.addMarket({
    marketId: "mock-1.stop",
    marketName: "Stop test",
    eventName: "Stop",
    startTime: new Date(NOW0.getTime() + 30 * 60_000),
    country: "GB",
    raceType: "flat",
    scenario: "stable",
    runners: [{ selectionId: 1, name: "Target", initialPrice: truePrice }],
  });
  return client;
}

beforeEach(async () => {
  await resetDb();
  resetRunnerHistory();
  resetBetAngelClientCache();
  tradingBus.removeAllListeners();
  // stopLossTicks = 2 per default, but reassert explicitly.
  await updateStrategyConfig({ stopLossTicks: 2 });
});

afterEach(() => {
  tradingBus.removeAllListeners();
});

describe("stop-loss — triggering conditions", () => {
  it("fires on a matched BACK when price drifts upward by >= stopLossTicks", async () => {
    const client = newMockWithRunner(3.0);
    const { trade } = await seedOpenTrade({
      matchedLegSide: "back",
      matchedLegPrice: 3.0,
      otherLegPrice: 2.98,
    });

    // Drift the market up by setting scenario=drifting and stepping a lot.
    // We also bump truePrice directly to ensure the synthetic bestBack has
    // moved well beyond 2 ticks above 3.0 (in the 2-3 band tick = 0.02, so
    // 2 ticks above 3.0 is 3.04). Moving truePrice to 3.20 puts bestBack at
    // ~3.18 — deeply adverse.
    const m = client.getMarket("mock-1.stop")!;
    const runner = m.runners.get(1)!;
    runner.truePrice = 3.2;

    await tickStopLoss(client);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("stopped");
    expect(refreshed.exitReason).toBe("stop_loss");
    expect(refreshed.closedAt).not.toBeNull();
  });

  it("fires on a matched LAY when price steams downward by >= stopLossTicks", async () => {
    const client = newMockWithRunner(3.0);
    const { trade } = await seedOpenTrade({
      matchedLegSide: "lay",
      matchedLegPrice: 3.0,
      otherLegPrice: 3.02,
    });

    const runner = client.getMarket("mock-1.stop")!.runners.get(1)!;
    runner.truePrice = 2.8;

    await tickStopLoss(client);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("stopped");
    expect(refreshed.exitReason).toBe("stop_loss");
  });

  it("does not fire when the market is favourable", async () => {
    const client = newMockWithRunner(3.0);
    const { trade } = await seedOpenTrade({
      matchedLegSide: "back",
      matchedLegPrice: 3.0,
      otherLegPrice: 2.98,
    });

    // Price drops → good for a matched back.
    client.getMarket("mock-1.stop")!.runners.get(1)!.truePrice = 2.7;

    await tickStopLoss(client);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("open");
  });

  it("does not fire when the adverse move is less than stopLossTicks", async () => {
    const client = newMockWithRunner(3.0);
    const { trade } = await seedOpenTrade({
      matchedLegSide: "back",
      matchedLegPrice: 3.0,
      otherLegPrice: 2.98,
    });

    // Move up by 1 tick only (0.02 in band 2). stopLossTicks = 2.
    client.getMarket("mock-1.stop")!.runners.get(1)!.truePrice = 3.02;

    await tickStopLoss(client);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("open");
  });

  it("does not fire when both legs are matched (not our scenario)", async () => {
    const client = newMockWithRunner(3.0);
    const m = await prisma.tradingMarket.create({
      data: {
        betfairMarketId: "mock-1.stop",
        name: "Double matched",
        startTime: new Date(NOW0.getTime() + 30 * 60_000),
        totalMatched: 100_000,
        numRunners: 1,
        status: "trading",
      },
    });
    const r = await prisma.tradingRunner.create({
      data: { marketId: m.id, selectionId: 1, horseName: "Target" },
    });
    const trade = await prisma.trade.create({
      data: {
        marketId: m.id,
        runnerId: r.id,
        entryBackPrice: 3.02,
        entryLayPrice: 2.98,
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
          price: 3.02,
          size: 10,
          matchedSize: 10,
          status: "matched",
        },
        {
          tradeId: trade.id,
          side: "lay",
          purpose: "entry",
          price: 2.98,
          size: 10,
          matchedSize: 10,
          status: "matched",
        },
      ],
    });

    client.getMarket("mock-1.stop")!.runners.get(1)!.truePrice = 3.5; // big adverse
    await tickStopLoss(client);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("open"); // untouched — tickOpenTrades handles it instead
  });

  it("emits trade:close event when stop triggers", async () => {
    const client = newMockWithRunner(3.0);
    const events: Array<{ reason: string | null }> = [];
    tradingBus.on("trade:close", (p) => events.push({ reason: p.exitReason }));

    await seedOpenTrade({
      matchedLegSide: "back",
      matchedLegPrice: 3.0,
      otherLegPrice: 2.98,
    });
    client.getMarket("mock-1.stop")!.runners.get(1)!.truePrice = 3.3;

    await tickStopLoss(client);

    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("stop_loss");
  });
});
