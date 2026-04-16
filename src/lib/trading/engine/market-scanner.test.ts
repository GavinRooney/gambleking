import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import { scanMarkets, DEFAULT_SCANNER_CONFIG, type ScannerConfig } from "./market-scanner";

const NOW = new Date("2026-04-16T12:00:00Z");
function inMinutes(n: number): Date {
  return new Date(NOW.getTime() + n * 60_000);
}

beforeEach(async () => {
  // Clear trading tables so each test starts from a clean slate. Order
  // matters: rows with FKs must be deleted before their parents.
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
});

function buildClientWithMarkets(markets: Array<{
  marketId: string;
  startTime: Date;
  totalMatched?: number;
  numRunners?: number;
  country?: "GB" | "IE";
  raceType?: "flat" | "hurdle" | "chase" | "bumper";
}>): MockBetAngelClient {
  const client = new MockBetAngelClient({ seed: 1 });
  for (const m of markets) {
    const numRunners = m.numRunners ?? 8;
    const runners = Array.from({ length: numRunners }, (_, i) => ({
      selectionId: i + 1,
      name: `Runner ${i + 1}`,
      initialPrice: 3.0 + i * 0.5,
    }));
    client.addMarket({
      marketId: m.marketId,
      marketName: `R1 ${m.marketId}`,
      eventName: `${m.marketId} Test`,
      startTime: m.startTime,
      country: m.country ?? "GB",
      raceType: m.raceType ?? "flat",
      runners,
    });
    // The mock sets totalMatched from trading activity; for scanner tests we
    // mutate internal state directly because the scanner filters on volume.
    const market = client.getMarket(m.marketId);
    if (market && m.totalMatched != null) market.totalMatched = m.totalMatched;
  }
  return client;
}

describe("market scanner — qualification filters", () => {
  it("qualifies a well-formed market and writes it to TradingMarket", async () => {
    const client = buildClientWithMarkets([
      { marketId: "1.100", startTime: inMinutes(30), totalMatched: 100_000, numRunners: 10 },
    ]);
    const result = await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);

    expect(result.qualified).toEqual(["1.100"]);
    expect(result.rejected).toEqual([]);

    const row = await prisma.tradingMarket.findUnique({
      where: { betfairMarketId: "1.100" },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("scanning");
    expect(row!.numRunners).toBe(10);
    expect(row!.totalMatched).toBe(100_000);
  });

  it("rejects markets with too little matched volume", async () => {
    const client = buildClientWithMarkets([
      { marketId: "1.101", startTime: inMinutes(30), totalMatched: 1_000, numRunners: 10 },
    ]);
    const result = await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);
    // Client-side filter also excludes this one, so scan returns zero qualified.
    // Either way the market must NOT appear in the DB.
    expect(result.qualified).not.toContain("1.101");
    const row = await prisma.tradingMarket.findUnique({
      where: { betfairMarketId: "1.101" },
    });
    expect(row).toBeNull();
  });

  it("rejects markets outside the runner-count range", async () => {
    const cfg: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG, minRunners: 6, maxRunners: 20 };
    const client = buildClientWithMarkets([
      { marketId: "1.102", startTime: inMinutes(30), totalMatched: 100_000, numRunners: 3 },
      { marketId: "1.103", startTime: inMinutes(30), totalMatched: 100_000, numRunners: 30 },
    ]);
    const result = await scanMarkets(client, cfg, NOW);
    expect(result.qualified).toEqual([]);
    expect(result.rejected.map((r) => r.marketId).sort()).toEqual(["1.102", "1.103"]);
  });

  it("rejects markets starting too soon or too far out", async () => {
    const cfg: ScannerConfig = {
      ...DEFAULT_SCANNER_CONFIG,
      minMinutesToStart: 5,
      maxMinutesToStart: 60,
    };
    const client = buildClientWithMarkets([
      { marketId: "1.104", startTime: inMinutes(2), totalMatched: 100_000 }, // too soon
      { marketId: "1.105", startTime: inMinutes(120), totalMatched: 100_000 }, // too far
      { marketId: "1.106", startTime: inMinutes(30), totalMatched: 100_000 }, // ok
    ]);
    const result = await scanMarkets(client, cfg, NOW);
    expect(result.qualified).toEqual(["1.106"]);
  });

  it("filters by country", async () => {
    const cfg: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG, countries: ["GB"] };
    const client = buildClientWithMarkets([
      { marketId: "1.107", startTime: inMinutes(30), totalMatched: 100_000, country: "IE" },
      { marketId: "1.108", startTime: inMinutes(30), totalMatched: 100_000, country: "GB" },
    ]);
    const result = await scanMarkets(client, cfg, NOW);
    expect(result.qualified).toEqual(["1.108"]);
  });

  it("is idempotent: a second scan updates the same row, doesn't duplicate", async () => {
    const client = buildClientWithMarkets([
      { marketId: "1.109", startTime: inMinutes(30), totalMatched: 100_000, numRunners: 8 },
    ]);
    await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);
    // Bump volume — a second scan should refresh totalMatched.
    const market = client.getMarket("1.109")!;
    market.totalMatched = 150_000;
    await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);

    const rows = await prisma.tradingMarket.findMany({
      where: { betfairMarketId: "1.109" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].totalMatched).toBe(150_000);
  });

  it("does not regress an already-promoted market's status back to scanning", async () => {
    const client = buildClientWithMarkets([
      { marketId: "1.110", startTime: inMinutes(30), totalMatched: 100_000, numRunners: 8 },
    ]);
    await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);
    // Simulate the OMS having promoted this market to trading.
    await prisma.tradingMarket.update({
      where: { betfairMarketId: "1.110" },
      data: { status: "trading" },
    });
    await scanMarkets(client, DEFAULT_SCANNER_CONFIG, NOW);
    const row = await prisma.tradingMarket.findUnique({
      where: { betfairMarketId: "1.110" },
    });
    expect(row!.status).toBe("trading"); // untouched
  });
});
