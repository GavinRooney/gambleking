import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { scanMarkets, DEFAULT_SCANNER_CONFIG } from "./market-scanner";
import {
  selectRunners,
  DEFAULT_RUNNER_SELECTOR_CONFIG,
  resetRunnerHistory,
} from "./runner-selector";

const NOW0 = new Date("2026-04-16T12:00:00Z");
const atTickMs = (baseMs: number) => new Date(NOW0.getTime() + baseMs);

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
}

function seedClient(seed = 1) {
  const client = new MockBetAngelClient({ seed });
  client.addMarket({
    marketId: "1.100",
    marketName: "R1 Hcap Hrd",
    eventName: "14:30 Ascot",
    startTime: new Date(NOW0.getTime() + 30 * 60_000),
    country: "GB",
    raceType: "hurdle",
    runners: [
      { selectionId: 101, name: "Lucky Hoare", initialPrice: 3.0 },
      { selectionId: 102, name: "Second Horse", initialPrice: 5.0 },
      { selectionId: 103, name: "Third Horse", initialPrice: 8.0 },
      { selectionId: 104, name: "Fourth", initialPrice: 12.0 },
      { selectionId: 105, name: "Fifth", initialPrice: 17.0 },
      { selectionId: 106, name: "Sixth", initialPrice: 25.0 },
      { selectionId: 107, name: "Seventh", initialPrice: 34.0 },
      { selectionId: 108, name: "Eighth", initialPrice: 50.0 },
    ],
  });
  // Ensure market passes scanner filters.
  client.getMarket("1.100")!.totalMatched = 100_000;
  return client;
}

async function seedMarketRow(client: MockBetAngelClient) {
  await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW0);
}

beforeEach(async () => {
  await resetDb();
  resetRunnerHistory();
});

describe("runner-selector — basic signal extraction", () => {
  it("populates TradingRunner rows with names, prices, and initial stats", async () => {
    const client = seedClient();
    await seedMarketRow(client);

    const result = await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, NOW0);

    expect(result.markets).toHaveLength(1);
    const signals = result.markets[0].runners;
    expect(signals.length).toBe(8);

    const lucky = signals.find((r) => r.selectionId === 101)!;
    expect(lucky.name).toBe("Lucky Hoare");
    expect(lucky.bestBack).toBeGreaterThan(0);
    expect(lucky.bestLay).toBeGreaterThan(lucky.bestBack!);

    // Volatility is null on the first pass (only one sample in the window).
    expect(lucky.volatilityScore).toBeNull();

    // Rows persisted.
    const rows = await prisma.tradingRunner.findMany();
    expect(rows.length).toBe(8);
    const luckyRow = rows.find((r) => r.selectionId === 101)!;
    expect(luckyRow.horseName).toBe("Lucky Hoare");
  });

  it("is idempotent: a second call updates rows, does not duplicate", async () => {
    const client = seedClient();
    await seedMarketRow(client);
    await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, NOW0);
    await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, atTickMs(500));
    const rows = await prisma.tradingRunner.findMany();
    expect(rows.length).toBe(8);
  });

  it("skips markets the client no longer exposes (race suspended / started)", async () => {
    const client = seedClient();
    await seedMarketRow(client);
    // Drop the market from the client mid-session.
    client.removeMarket("1.100");
    // Selector should not throw — just skip.
    const result = await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, NOW0);
    expect(result.markets).toEqual([]);
  });
});

describe("runner-selector — volatility score across scenarios", () => {
  // The volatility window is 30 s; sample ticks at 500 ms to fill it with
  // 60 samples per runner. Stable scenarios should produce a markedly lower
  // stddev than drifting/steaming ones.
  async function rollingVolatility(
    scenario: "stable" | "drifting" | "steaming",
    seed: number
  ): Promise<number> {
    await resetDb();
    resetRunnerHistory();
    const client = seedClient(seed);
    client.setScenario("1.100", scenario);
    await seedMarketRow(client);

    let lastScore: number | null = null;
    for (let i = 0; i < 60; i++) {
      client.step();
      const result = await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, atTickMs(i * 500));
      lastScore = result.markets[0].runners[0].volatilityScore;
    }
    if (lastScore === null) throw new Error("no score produced");
    return lastScore;
  }

  it("stable markets have lower volatility than drifting", async () => {
    const stable = await rollingVolatility("stable", 101);
    const drifting = await rollingVolatility("drifting", 101);
    expect(drifting).toBeGreaterThan(stable);
  });

  it("steaming markets have higher volatility than stable", async () => {
    const stable = await rollingVolatility("stable", 202);
    const steaming = await rollingVolatility("steaming", 202);
    expect(steaming).toBeGreaterThan(stable);
  });
});

describe("runner-selector — book balance", () => {
  it("computes book balance as the ratio of top-level back/lay sizes", async () => {
    const client = seedClient();
    await seedMarketRow(client);
    const result = await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, NOW0);
    const r = result.markets[0].runners[0];
    expect(r.bookBalance).not.toBeNull();
    // Mock book has symmetric distribution ± PRNG noise; balance should be
    // broadly near 1.0 but not exactly.
    expect(r.bookBalance!).toBeGreaterThan(0.3);
    expect(r.bookBalance!).toBeLessThan(3);
  });
});

describe("runner-selector — traded volume rank", () => {
  it("ranks runners by cumulative traded volume (most-traded first)", async () => {
    const client = seedClient();
    await seedMarketRow(client);

    // Drive some matches on runner 103 so it has the deepest matched volume.
    // The mock's immediate-match rule: back at or above best lay matches.
    const prices = await client.getMarketPrices("1.100");
    const top103 = prices.runners.find((r) => r.selectionId === 103)!.availableToLay[0].price;
    for (let i = 0; i < 10; i++) {
      await client.placeOrder({
        marketId: "1.100",
        selectionId: 103,
        side: "back",
        price: top103,
        size: 5,
      });
    }

    const result = await selectRunners(client, DEFAULT_RUNNER_SELECTOR_CONFIG, NOW0);
    const rankById = new Map(result.markets[0].runners.map((r) => [r.selectionId, r.tradedVolumeRank]));
    // 103 should rank ahead of every other runner (rank 0).
    expect(rankById.get(103)).toBe(0);
    // All ranks are unique, in [0, numRunners-1].
    const ranks = [...rankById.values()].sort();
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
