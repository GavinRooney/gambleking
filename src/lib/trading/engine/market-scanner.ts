// Market scanner — PRD §6.1.
//
// Pulls the list of upcoming horse racing markets from the BetAngelClient,
// applies filters from StrategyConfig, and upserts qualifying markets into
// the `TradingMarket` table with status="scanning". Downstream stages
// (runner-selector, OMS) read from this table rather than re-querying the
// client, so the DB is the single source of truth for "what the engine is
// currently watching."
//
// Scanning is idempotent — calling `scanMarkets()` on every tick safely
// refreshes the set of tracked markets without duplicating rows.

import type { BetAngelClient, ListMarketsFilter, MarketSummary } from "../bet-angel/client";
import { prisma } from "@/lib/db";

export type ScannerConfig = {
  // Minimum total matched volume in £ for a market to qualify. Thin markets
  // make price discovery noisy and fills unreliable.
  minMarketVolume: number;
  // Time-to-start window in minutes. PRD §6.1: markets need "at least a
  // configurable minimum time remaining" (default 5 min) and we also want
  // an upper bound so we don't preload races hours ahead.
  minMinutesToStart: number;
  maxMinutesToStart: number;
  // Runner count range. Single-digit fields have thin liquidity; huge fields
  // (25+ runner handicaps) have excessive uncertainty.
  minRunners: number;
  maxRunners: number;
  // Country filter; default GB + IE per project scope.
  countries: string[];
  // Race-type filter; hurdle markets sometimes need to be excluded.
  raceTypes?: Array<NonNullable<MarketSummary["raceType"]>>;
};

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  minMarketVolume: 50_000,
  minMinutesToStart: 5,
  maxMinutesToStart: 240,
  minRunners: 6,
  maxRunners: 20,
  countries: ["GB", "IE"],
};

export type ScanResult = {
  qualified: string[];     // Betfair market IDs that passed all filters
  rejected: Array<{ marketId: string; reason: string }>;
  scannedAt: Date;
};

// Pull markets from the client, filter, and upsert into the DB.
// `now` is injectable so tests don't depend on wall-clock time.
export async function scanMarkets(
  client: BetAngelClient,
  config: ScannerConfig = DEFAULT_SCANNER_CONFIG,
  now: Date = new Date()
): Promise<ScanResult> {
  const clientFilter: ListMarketsFilter = {
    country: config.countries,
    raceTypes: config.raceTypes,
    fromStartTime: new Date(now.getTime() + config.minMinutesToStart * 60_000),
    toStartTime: new Date(now.getTime() + config.maxMinutesToStart * 60_000),
    minTotalMatched: config.minMarketVolume,
  };

  const markets = await client.listMarkets(clientFilter);

  const qualified: string[] = [];
  const rejected: ScanResult["rejected"] = [];

  for (const m of markets) {
    const reason = disqualify(m, config);
    if (reason) {
      rejected.push({ marketId: m.marketId, reason });
      continue;
    }
    qualified.push(m.marketId);
    await upsertTrackedMarket(m);
  }

  return { qualified, rejected, scannedAt: now };
}

// Re-checks filters locally (the client-side filter is a hint; some clients
// may return best-effort results). Returns a rejection reason string, or null
// if the market qualifies.
function disqualify(m: MarketSummary, cfg: ScannerConfig): string | null {
  if (m.totalMatched < cfg.minMarketVolume) {
    return `totalMatched ${m.totalMatched} below minMarketVolume ${cfg.minMarketVolume}`;
  }
  if (m.numRunners < cfg.minRunners || m.numRunners > cfg.maxRunners) {
    return `numRunners ${m.numRunners} outside [${cfg.minRunners}, ${cfg.maxRunners}]`;
  }
  if (!cfg.countries.includes(m.country)) {
    return `country ${m.country} not in ${cfg.countries.join(",")}`;
  }
  if (cfg.raceTypes && m.raceType && !cfg.raceTypes.includes(m.raceType)) {
    return `raceType ${m.raceType} not in ${cfg.raceTypes.join(",")}`;
  }
  return null;
}

async function upsertTrackedMarket(m: MarketSummary): Promise<void> {
  await prisma.tradingMarket.upsert({
    where: { betfairMarketId: m.marketId },
    create: {
      betfairMarketId: m.marketId,
      name: m.marketName,
      startTime: m.startTime,
      totalMatched: m.totalMatched,
      numRunners: m.numRunners,
      status: "scanning",
    },
    update: {
      name: m.marketName,
      startTime: m.startTime,
      totalMatched: m.totalMatched,
      numRunners: m.numRunners,
      // Leave status alone — later stages (OMS) may have promoted the market
      // to "trading" or "warned" and we mustn't regress that.
    },
  });
}
