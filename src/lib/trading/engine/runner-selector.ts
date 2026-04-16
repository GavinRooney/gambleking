// Runner selector — PRD §6.2.
//
// For every market the scanner has flagged as active, pull the current price
// book and compute per-runner signals the OMS uses to decide whether a runner
// is a viable scalp candidate:
//
//   volatilityScore — stddev of the best-back price over a 30-second rolling
//     window. Low = stable, the prerequisite for a safe scalp. High = price is
//     drifting or steaming; one leg of a paired order is likely to be stranded.
//
//   bookBalance — size(availableToBack[0]) / size(availableToLay[0]). PRD §2.3
//     asks for "approximately equal on both sides"; we aim for 0.7–1.3 (both
//     bounds configurable via StrategyConfig).
//
//   tradedVolumeRank — 0-indexed rank of the runner within its market by
//     cumulative traded volume. Rank 0 = most-traded = deepest liquidity.
//
// Each tick overwrites the persisted signals on TradingRunner. Rolling price
// history is kept in-memory (process-local Map) — a restart loses the last
// 30 s of context, which rebuilds automatically on the next few ticks.
//
// This module computes signals; the OMS (next task) decides what to do with
// them. Keeping that split means signal-generation and strategy are testable
// in isolation.

import type { BetAngelClient, MarketPrices, RunnerPrices } from "../bet-angel/client";
import { prisma } from "@/lib/db";
import { tradingBus } from "../events";

export type RunnerSelectorConfig = {
  volatilityWindowMs: number;
};

export const DEFAULT_RUNNER_SELECTOR_CONFIG: RunnerSelectorConfig = {
  volatilityWindowMs: 30_000,
};

export type RunnerSignals = {
  marketId: string;        // DB id of TradingMarket
  runnerId: string;        // DB id of TradingRunner
  selectionId: number;
  name: string;
  bestBack: number | null;
  bestLay: number | null;
  volatilityScore: number | null; // null until we have ≥2 samples in window
  bookBalance: number | null;     // null if either side is empty
  tradedVolumeRank: number;
  traded: number;
};

export type RunnerSelectorResult = {
  markets: Array<{ marketId: string; betfairMarketId: string; runners: RunnerSignals[] }>;
  at: Date;
};

// In-memory rolling window of best-back prices keyed by
// `${betfairMarketId}:${selectionId}`. Stashed on globalThis to survive hot
// reload (same pattern as the event bus / prisma client).
type PriceSample = { t: number; price: number };
type HistoryMap = Map<string, PriceSample[]>;

const globalForHistory = globalThis as unknown as {
  runnerSelectorHistory: HistoryMap | undefined;
};
if (!globalForHistory.runnerSelectorHistory) {
  globalForHistory.runnerSelectorHistory = new Map();
}
const history: HistoryMap = globalForHistory.runnerSelectorHistory;

function historyKey(betfairMarketId: string, selectionId: number): string {
  return `${betfairMarketId}:${selectionId}`;
}

// Test/admin hook.
export function resetRunnerHistory(): void {
  history.clear();
}

// Drive one selector pass. Reads markets the scanner persisted, fetches
// current prices, computes signals, writes them back. Returns the signals so
// the caller (OMS or a test) can inspect without re-querying the DB.
export async function selectRunners(
  client: BetAngelClient,
  config: RunnerSelectorConfig = DEFAULT_RUNNER_SELECTOR_CONFIG,
  now: Date = new Date()
): Promise<RunnerSelectorResult> {
  const trackedMarkets = await prisma.tradingMarket.findMany({
    where: { status: { in: ["scanning", "trading", "warned"] } },
  });

  const result: RunnerSelectorResult = { markets: [], at: now };

  for (const market of trackedMarkets) {
    let prices: MarketPrices;
    let nameBySelectionId = new Map<number, string>();
    try {
      // Prices + details together — one extra call per market per tick, cheap.
      // The HTTP client will be able to cache details since names don't change
      // for a race; for now we just fetch both each pass.
      const [p, d] = await Promise.all([
        client.getMarketPrices(market.betfairMarketId),
        client.getMarketDetails(market.betfairMarketId),
      ]);
      prices = p;
      nameBySelectionId = new Map(d.runners.map((r) => [r.selectionId, r.name]));
    } catch {
      // Client may have dropped the market (race started, suspended). Skip;
      // the forced-exit logic (M3) owns transitions to closed state.
      continue;
    }

    const ranks = rankRunnersByTradedVolume(prices.runners);
    const runnerSignals: RunnerSignals[] = [];

    for (const rp of prices.runners) {
      if (rp.status !== "ACTIVE") continue;
      const bestBack = rp.availableToBack[0]?.price ?? null;
      const bestLay = rp.availableToLay[0]?.price ?? null;

      // Append best-back price to the rolling window. availableToBack[0] is
      // the top of the "backable" side — conventionally the primary signal
      // for price-stability analysis pre-off.
      const key = historyKey(market.betfairMarketId, rp.selectionId);
      const samples = history.get(key) ?? [];
      if (bestBack != null) samples.push({ t: now.getTime(), price: bestBack });
      // Drop samples outside the window.
      const cutoff = now.getTime() - config.volatilityWindowMs;
      while (samples.length && samples[0].t < cutoff) samples.shift();
      history.set(key, samples);

      const volatilityScore = samples.length >= 2 ? stddev(samples.map((s) => s.price)) : null;
      const bookBalance = computeBookBalance(rp);
      const tradedVolumeRank = ranks.get(rp.selectionId) ?? 0;

      const horseName = nameBySelectionId.get(rp.selectionId) ?? `Selection ${rp.selectionId}`;

      // Upsert the runner row.
      const upserted = await prisma.tradingRunner.upsert({
        where: {
          marketId_selectionId: { marketId: market.id, selectionId: rp.selectionId },
        },
        create: {
          marketId: market.id,
          selectionId: rp.selectionId,
          horseName,
          bestBack,
          bestLay,
          traded: rp.totalMatched,
          volatilityScore,
          bookBalance,
        },
        update: {
          bestBack,
          bestLay,
          traded: rp.totalMatched,
          volatilityScore,
          bookBalance,
        },
      });

      runnerSignals.push({
        marketId: market.id,
        runnerId: upserted.id,
        selectionId: rp.selectionId,
        name: upserted.horseName,
        bestBack,
        bestLay,
        volatilityScore,
        bookBalance,
        tradedVolumeRank,
        traded: rp.totalMatched,
      });
    }

    result.markets.push({
      marketId: market.id,
      betfairMarketId: market.betfairMarketId,
      runners: runnerSignals,
    });

    // Broadcast updated prices so the dashboard / market detail pages can
    // refresh without polling. One event per market per tick — at 2 Hz with
    // ~10 markets that's ~20 events/sec, well within the SSE budget.
    tradingBus.emit("market:update", {
      marketId: market.id,
      runners: runnerSignals.map((r) => ({
        runnerId: r.runnerId,
        bestBack: r.bestBack,
        bestLay: r.bestLay,
        traded: r.traded,
      })),
      at: now.getTime(),
    });
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeBookBalance(rp: RunnerPrices): number | null {
  const back = rp.availableToBack[0]?.size;
  const lay = rp.availableToLay[0]?.size;
  if (!back || !lay || lay === 0) return null;
  return back / lay;
}

function rankRunnersByTradedVolume(runners: RunnerPrices[]): Map<number, number> {
  const sorted = [...runners].sort((a, b) => b.totalMatched - a.totalMatched);
  const ranks = new Map<number, number>();
  sorted.forEach((r, i) => ranks.set(r.selectionId, i));
  return ranks;
}

