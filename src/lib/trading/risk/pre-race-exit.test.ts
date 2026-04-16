import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { tickPreRaceExit } from "./pre-race-exit";
import { updateStrategyConfig } from "../strategy-config";
import { tradingBus } from "../events";
import { resetBetAngelClientCache } from "../bet-angel";
import { resetRunnerHistory } from "../engine/runner-selector";
import { openTrade } from "../engine/oms";

const NOW = new Date("2026-04-16T14:30:00Z");

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
  await prisma.strategyConfig.deleteMany({});
}

async function seedMarket(
  client: MockBetAngelClient,
  opts: { startInSeconds: number; status?: "scanning" | "trading" | "warned" }
) {
  const marketId = `mock-1.race`;
  const startTime = new Date(NOW.getTime() + opts.startInSeconds * 1000);
  client.addMarket({
    marketId,
    marketName: "Race",
    eventName: "14:30 Ascot",
    startTime,
    country: "GB",
    raceType: "flat",
    scenario: "stable",
    runners: [{ selectionId: 1, name: "Target", initialPrice: 3.0 }],
  });
  client.getMarket(marketId)!.totalMatched = 100_000;
  const m = await prisma.tradingMarket.create({
    data: {
      betfairMarketId: marketId,
      name: "Race",
      startTime,
      totalMatched: 100_000,
      numRunners: 1,
      status: opts.status ?? "scanning",
    },
  });
  const r = await prisma.tradingRunner.create({
    data: { marketId: m.id, selectionId: 1, horseName: "Target" },
  });
  return { market: m, runner: r };
}

beforeEach(async () => {
  await resetDb();
  resetRunnerHistory();
  resetBetAngelClientCache();
  tradingBus.removeAllListeners();
  process.env.BET_ANGEL_MODE = "mock";
  await updateStrategyConfig({
    preRaceWarningSeconds: 60,
    preRaceExitSeconds: 10,
  });
});

afterEach(() => {
  tradingBus.removeAllListeners();
});

function newMock(): MockBetAngelClient {
  return new MockBetAngelClient({ seed: 31 });
}

describe("pre-race-exit — status transitions", () => {
  it("does not transition a market with plenty of time remaining", async () => {
    const client = newMock();
    const { market } = await seedMarket(client, { startInSeconds: 600 }); // 10 min
    await tickPreRaceExit(client, NOW);
    const refreshed = await prisma.tradingMarket.findUniqueOrThrow({ where: { id: market.id } });
    expect(refreshed.status).toBe("scanning");
  });

  it("promotes to 'warned' inside the warning window", async () => {
    const client = newMock();
    const { market } = await seedMarket(client, { startInSeconds: 45 }); // < 60s warning
    await tickPreRaceExit(client, NOW);
    const refreshed = await prisma.tradingMarket.findUniqueOrThrow({ where: { id: market.id } });
    expect(refreshed.status).toBe("warned");
  });

  it("promotes to 'exited' inside the hard-exit window", async () => {
    const client = newMock();
    const { market } = await seedMarket(client, { startInSeconds: 5 }); // < 10s hard exit
    await tickPreRaceExit(client, NOW);
    const refreshed = await prisma.tradingMarket.findUniqueOrThrow({ where: { id: market.id } });
    expect(refreshed.status).toBe("exited");
  });

  it("hard-exit path still applies to a market already in 'warned' state", async () => {
    const client = newMock();
    const { market } = await seedMarket(client, { startInSeconds: 5, status: "warned" });
    await tickPreRaceExit(client, NOW);
    const refreshed = await prisma.tradingMarket.findUniqueOrThrow({ where: { id: market.id } });
    expect(refreshed.status).toBe("exited");
  });
});

describe("pre-race-exit — forced trade flattening", () => {
  it("flattens every open trade in a market entering the hard-exit window", async () => {
    const client = newMock();
    const { market, runner } = await seedMarket(client, { startInSeconds: 5 });

    // Create an open trade manually (don't go through openTrade; the
    // market status is 'scanning' at seed time so it would pass, but we
    // want isolation from other paths).
    const trade1 = await prisma.trade.create({
      data: {
        marketId: market.id,
        runnerId: runner.id,
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
          tradeId: trade1.id,
          side: "back",
          purpose: "entry",
          price: 3.02,
          size: 10,
          matchedSize: 10, // fully matched back
          status: "matched",
        },
        {
          tradeId: trade1.id,
          side: "lay",
          purpose: "entry",
          price: 2.98,
          size: 10,
          matchedSize: 0, // unmatched lay
          status: "unmatched",
        },
      ],
    });

    await tickPreRaceExit(client, NOW);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade1.id } });
    expect(refreshed.status).toBe("forced_exit");
    expect(refreshed.exitReason).toBe("forced_exit");
    expect(refreshed.closedAt).not.toBeNull();
  });

  it("doesn't flatten trades in markets not yet at hard-exit (just warned)", async () => {
    const client = newMock();
    const { market, runner } = await seedMarket(client, { startInSeconds: 45 }); // warning window

    const trade = await prisma.trade.create({
      data: {
        marketId: market.id,
        runnerId: runner.id,
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

    await tickPreRaceExit(client, NOW);

    const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(refreshed.status).toBe("open"); // only market status changes in warning stage
  });
});

describe("pre-race-exit — OMS refuses to open in warned/exited markets", () => {
  it("openTrade returns 'skipped' when the market is in 'warned' state", async () => {
    const client = newMock();
    const { runner } = await seedMarket(client, { startInSeconds: 45 }); // warning window
    // Promote via the risk tick.
    await tickPreRaceExit(client, NOW);

    const session = await prisma.tradingSession.create({
      data: { date: NOW, mode: "mock", startedAt: NOW },
    });

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toMatch(/warned/);
    }
  });

  it("openTrade returns 'skipped' when the market is in 'exited' state", async () => {
    const client = newMock();
    const { runner } = await seedMarket(client, { startInSeconds: 5 });
    await tickPreRaceExit(client, NOW);

    const session = await prisma.tradingSession.create({
      data: { date: NOW, mode: "mock", startedAt: NOW },
    });

    const result = await openTrade(client, {
      sessionId: session.id,
      runnerId: runner.id,
      stake: 10,
      maxConcurrentPerMarket: 5,
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toMatch(/exited/);
    }
  });
});
