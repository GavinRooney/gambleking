import { describe, it, expect, beforeEach } from "vitest";
import { MockBetAngelClient } from "./mock-client";
import { BetAngelError } from "./types";

const T0 = new Date("2026-04-16T14:30:00Z");

function buildClient(seed = 1) {
  return new MockBetAngelClient({ seed });
}

function addDefaultMarket(
  client: MockBetAngelClient,
  overrides: Partial<{ marketId: string; scenario: "stable" | "drifting" | "steaming" | "thin-book"; initialPrice: number }> = {}
) {
  const marketId = overrides.marketId ?? "1.100";
  client.addMarket({
    marketId,
    marketName: "R1 2m Hcap Hrd",
    eventName: "14:30 Ascot",
    startTime: T0,
    courseName: "Ascot",
    country: "GB",
    raceType: "hurdle",
    scenario: overrides.scenario ?? "stable",
    runners: [
      { selectionId: 101, name: "Lucky Hoare", initialPrice: overrides.initialPrice ?? 3.0 },
      { selectionId: 102, name: "Second Horse", initialPrice: 5.0 },
    ],
  });
  return marketId;
}

describe("MockBetAngelClient — market discovery", () => {
  let client: MockBetAngelClient;
  beforeEach(() => (client = buildClient()));

  it("returns added markets via listMarkets", async () => {
    addDefaultMarket(client);
    const markets = await client.listMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].marketId).toBe("1.100");
    expect(markets[0].numRunners).toBe(2);
    expect(markets[0].country).toBe("GB");
  });

  it("getMarketDetails returns runners", async () => {
    addDefaultMarket(client);
    const d = await client.getMarketDetails("1.100");
    expect(d.runners.map((r) => r.name)).toEqual(["Lucky Hoare", "Second Horse"]);
  });

  it("getMarketPrices returns a book with best back < best lay", async () => {
    addDefaultMarket(client);
    const p = await client.getMarketPrices("1.100");
    const r = p.runners.find((r) => r.selectionId === 101)!;
    expect(r.availableToBack.length).toBeGreaterThan(0);
    expect(r.availableToLay.length).toBeGreaterThan(0);
    expect(r.availableToBack[0].price).toBeLessThan(r.availableToLay[0].price);
  });

  it("filters by country and minTotalMatched", async () => {
    client.addMarket({
      marketId: "1.200",
      marketName: "R2 5f",
      eventName: "15:10 Leopardstown",
      startTime: T0,
      country: "IE",
      raceType: "flat",
      runners: [{ selectionId: 201, name: "R", initialPrice: 4 }],
    });
    addDefaultMarket(client);
    expect((await client.listMarkets({ country: ["IE"] })).map((m) => m.marketId)).toEqual(["1.200"]);
    expect(await client.listMarkets({ minTotalMatched: 1 })).toHaveLength(0);
  });

  it("requireMarket throws on unknown marketId", async () => {
    await expect(client.getMarketPrices("9.999")).rejects.toBeInstanceOf(BetAngelError);
  });
});

describe("MockBetAngelClient — addMarket input validation", () => {
  it("rejects a duplicate marketId", () => {
    const client = buildClient();
    addDefaultMarket(client);
    expect(() => addDefaultMarket(client)).toThrow(/already registered/);
  });

  it("rejects an empty runner list", () => {
    const client = buildClient();
    expect(() =>
      client.addMarket({
        marketId: "1.900",
        marketName: "Empty",
        eventName: "15:00 Nowhere",
        startTime: T0,
        runners: [],
      })
    ).toThrow(/at least one runner/);
  });

  it("rejects duplicate selectionIds within a market", () => {
    const client = buildClient();
    expect(() =>
      client.addMarket({
        marketId: "1.901",
        marketName: "Dup",
        eventName: "15:00 Nowhere",
        startTime: T0,
        runners: [
          { selectionId: 1, name: "A", initialPrice: 3 },
          { selectionId: 1, name: "B", initialPrice: 4 },
        ],
      })
    ).toThrow(/Duplicate selectionId/);
  });

  it("rejects initialPrice outside the Betfair ladder", () => {
    const client = buildClient();
    const base = {
      marketId: "1.902",
      marketName: "Bad price",
      eventName: "15:00 Nowhere",
      startTime: T0,
    };
    expect(() =>
      client.addMarket({ ...base, runners: [{ selectionId: 1, name: "A", initialPrice: 0.5 }] })
    ).toThrow(/outside the Betfair ladder/);
    expect(() =>
      client.addMarket({ ...base, runners: [{ selectionId: 1, name: "A", initialPrice: 5000 }] })
    ).toThrow(/outside the Betfair ladder/);
    expect(() =>
      client.addMarket({ ...base, runners: [{ selectionId: 1, name: "A", initialPrice: NaN }] })
    ).toThrow(/outside the Betfair ladder/);
  });

  it("accepts past startTime — test fixtures need to construct pre-race-exit scenarios", () => {
    const client = buildClient();
    expect(() =>
      client.addMarket({
        marketId: "1.903",
        marketName: "Past start",
        eventName: "14:00 yesterday",
        startTime: new Date("2020-01-01T00:00:00Z"),
        runners: [{ selectionId: 1, name: "A", initialPrice: 3 }],
      })
    ).not.toThrow();
  });
});

describe("MockBetAngelClient — scenario price movement", () => {
  it("stable markets don't drift far over many ticks", () => {
    const client = buildClient(42);
    addDefaultMarket(client, { scenario: "stable", initialPrice: 3.0 });
    for (let i = 0; i < 100; i++) client.step();
    const runner = client.getMarket("1.100")!.runners.get(101)!;
    // Stable: price should stay within ±10% of start over 100 ticks.
    expect(runner.truePrice).toBeGreaterThan(2.7);
    expect(runner.truePrice).toBeLessThan(3.3);
  });

  it("drifting markets trend upward", () => {
    const client = buildClient(42);
    addDefaultMarket(client, { scenario: "drifting", initialPrice: 3.0 });
    for (let i = 0; i < 100; i++) client.step();
    const runner = client.getMarket("1.100")!.runners.get(101)!;
    expect(runner.truePrice).toBeGreaterThan(3.3); // drifted up
  });

  it("steaming markets trend downward", () => {
    const client = buildClient(42);
    addDefaultMarket(client, { scenario: "steaming", initialPrice: 3.0 });
    for (let i = 0; i < 100; i++) client.step();
    const runner = client.getMarket("1.100")!.runners.get(101)!;
    expect(runner.truePrice).toBeLessThan(2.7); // steamed in
  });

  it("thin-book has much smaller sizes than stable", async () => {
    const thin = buildClient(1);
    addDefaultMarket(thin, { scenario: "thin-book" });
    const normal = buildClient(1);
    addDefaultMarket(normal, { scenario: "stable" });

    const thinPrices = (await thin.getMarketPrices("1.100")).runners[0].availableToBack[0].size;
    const normalPrices = (await normal.getMarketPrices("1.100")).runners[0].availableToBack[0].size;
    expect(thinPrices).toBeLessThan(normalPrices / 5);
  });
});

describe("MockBetAngelClient — order placement and matching", () => {
  let client: MockBetAngelClient;
  beforeEach(() => {
    client = buildClient(7);
    addDefaultMarket(client);
  });

  it("immediately matches a back order at or above best lay", async () => {
    const prices = await client.getMarketPrices("1.100");
    const bestLay = prices.runners[0].availableToLay[0].price;
    const result = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: bestLay, // crossing the spread
      size: 10,
    });
    expect(result.status).toBe("SUCCESS");
    expect(result.sizeMatched).toBe(10);
    expect(result.sizeRemaining).toBe(0);
  });

  it("leaves an order unmatched when placed inside the spread", async () => {
    const prices = await client.getMarketPrices("1.100");
    const runner = prices.runners.find((r) => r.selectionId === 101)!;
    const bestBack = runner.availableToBack[0].price;
    // Place a back at bestBack (below best lay) — should sit on the book.
    const result = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: bestBack,
      size: 10,
    });
    expect(result.sizeMatched).toBe(0);
    const status = await client.getOrderStatus(result.betId);
    expect(status.status).toBe("EXECUTABLE");
  });

  it("matches an unmatched order once the market crosses it", async () => {
    // Place a back at a price clearly below current best lay.
    const prices = await client.getMarketPrices("1.100");
    const currentBestBack = prices.runners[0].availableToBack[0].price;
    const result = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: currentBestBack,
      size: 10,
    });
    expect(result.sizeMatched).toBe(0);

    // Force the market to steam hard enough to cross our back price.
    client.setScenario("1.100", "steaming");
    let matched = false;
    for (let i = 0; i < 200 && !matched; i++) {
      client.step();
      const s = await client.getOrderStatus(result.betId);
      if (s.status === "EXECUTION_COMPLETE" && s.sizeMatched > 0) matched = true;
    }
    expect(matched).toBe(true);
  });

  it("cancels an executable order", async () => {
    const prices = await client.getMarketPrices("1.100");
    const bestBack = prices.runners[0].availableToBack[0].price;
    const placed = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: bestBack,
      size: 10,
    });
    const cancel = await client.cancelOrder(placed.betId);
    expect(cancel.status).toBe("SUCCESS");
    expect(cancel.sizeCancelled).toBe(10);
    const status = await client.getOrderStatus(placed.betId);
    expect(status.status).toBe("CANCELLED");
  });

  it("rejects invalid orders", async () => {
    await expect(
      client.placeOrder({ marketId: "1.100", selectionId: 999, side: "back", price: 3, size: 10 })
    ).rejects.toBeInstanceOf(BetAngelError);
    await expect(
      client.placeOrder({ marketId: "1.100", selectionId: 101, side: "back", price: 3, size: 0 })
    ).rejects.toBeInstanceOf(BetAngelError);
  });

  it("resting back joins availableToLay; resting lay joins availableToBack (Betfair convention)", async () => {
    const before = await client.getMarketPrices("1.100");
    const r0 = before.runners.find((r) => r.selectionId === 101)!;
    const bestBack = r0.availableToBack[0].price;
    const bestLay = r0.availableToLay[0].price;

    // Resting BACK inside the spread → takeable by a new LAYER → must show up
    // in availableToLay at its price.
    const restingBack = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: bestBack,
      size: 25,
    });
    expect(restingBack.sizeMatched).toBe(0);

    const after = await client.getMarketPrices("1.100");
    const r1 = after.runners.find((r) => r.selectionId === 101)!;
    // Sum sizes at bestBack in each side; availableToLay must include our 25.
    const layAt = r1.availableToLay.find((l) => l.price === bestBack)?.size ?? 0;
    expect(layAt).toBeGreaterThanOrEqual(25);

    // Resting LAY → takeable by a new BACKER → must appear in availableToBack.
    await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "lay",
      price: bestLay,
      size: 25,
    });
    const after2 = await client.getMarketPrices("1.100");
    const r2 = after2.runners.find((r) => r.selectionId === 101)!;
    const backAt = r2.availableToBack.find((b) => b.price === bestLay)?.size ?? 0;
    expect(backAt).toBeGreaterThanOrEqual(25);
  });
});

describe("MockBetAngelClient — Guardian", () => {
  it("adds, lists, and removes markets from the Guardian watchlist", async () => {
    const client = buildClient();
    addDefaultMarket(client, { marketId: "1.100" });
    addDefaultMarket(client, { marketId: "1.200" });

    await client.addMarketToGuardian("1.100");
    await client.addMarketToGuardian("1.200");
    let list = await client.listGuardianMarkets();
    expect(list.map((g) => g.marketId).sort()).toEqual(["1.100", "1.200"]);

    await client.removeMarketFromGuardian("1.100");
    list = await client.listGuardianMarkets();
    expect(list.map((g) => g.marketId)).toEqual(["1.200"]);
  });

  it("rejects unknown markets", async () => {
    const client = buildClient();
    await expect(client.addMarketToGuardian("9.999")).rejects.toBeInstanceOf(BetAngelError);
  });
});

describe("MockBetAngelClient — health check", () => {
  it("reports mock mode", async () => {
    const client = buildClient();
    const h = await client.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.mode).toBe("mock");
    expect(h.betAngelReachable).toBe(true);
  });
});

describe("MockBetAngelClient — lifecycle", () => {
  it("stop() pauses the tick loop but preserves state", async () => {
    const client = new MockBetAngelClient({ seed: 1, autoTickMs: 10 });
    addDefaultMarket(client);
    client.start();
    // Place an order so we have something in state to observe.
    const prices = await client.getMarketPrices("1.100");
    await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: prices.runners[0].availableToBack[0].price,
      size: 10,
    });

    client.stop();

    // State survives stop().
    expect((await client.listMarkets()).length).toBe(1);
    const status = (await client.getMarketDetails("1.100")).runners.length;
    expect(status).toBeGreaterThan(0);
  });

  it("reset() wipes markets, orders, and guardian state", async () => {
    const client = buildClient();
    addDefaultMarket(client);
    const placed = await client.placeOrder({
      marketId: "1.100",
      selectionId: 101,
      side: "back",
      price: 2.5,
      size: 10,
    });
    await client.addMarketToGuardian("1.100");

    client.reset();

    expect(await client.listMarkets()).toEqual([]);
    await expect(client.getOrderStatus(placed.betId)).rejects.toThrow();
    expect(await client.listGuardianMarkets()).toEqual([]);
  });

  it("reset() also stops the tick loop", () => {
    const client = new MockBetAngelClient({ seed: 1, autoTickMs: 10 });
    addDefaultMarket(client);
    client.start();
    client.reset();
    // If the interval had leaked, vitest would hang waiting for timers. Also
    // re-calling stop() after reset must be a safe no-op.
    expect(() => client.stop()).not.toThrow();
  });
});
