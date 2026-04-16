// GET /api/trading/analytics?mode=mock|practice|live|all
//
// One aggregated payload for the analytics page: KPIs, cumulative P&L
// time-series, exit-reason breakdown, best/worst markets. Server-side
// aggregation so the client just renders.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ModeFilter = "mock" | "practice" | "live" | "all";
type RangeFilter = "1h" | "24h" | "7d" | "30d" | "all";

function parseMode(raw: string | null): ModeFilter {
  if (raw === "practice" || raw === "live" || raw === "all") return raw;
  return "mock";
}

function parseRange(raw: string | null): RangeFilter {
  if (raw === "1h" || raw === "24h" || raw === "7d" || raw === "30d") return raw;
  return "all";
}

// Convert a range to a `since` Date; "all" returns null meaning no lower bound.
function rangeSince(range: RangeFilter, now: Date = new Date()): Date | null {
  const ms: Record<Exclude<RangeFilter, "all">, number> = {
    "1h": 60 * 60_000,
    "24h": 24 * 60 * 60_000,
    "7d": 7 * 24 * 60 * 60_000,
    "30d": 30 * 24 * 60 * 60_000,
  };
  if (range === "all") return null;
  return new Date(now.getTime() - ms[range]);
}

export async function GET(request: NextRequest) {
  try {
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));
    const range = parseRange(request.nextUrl.searchParams.get("range"));
    const closedStatuses = ["matched", "stopped", "forced_exit"];
    const since = rangeSince(range);

    const trades = await prisma.trade.findMany({
      where: {
        status: { in: closedStatuses },
        ...(mode === "all" ? {} : { mode }),
        ...(since ? { closedAt: { gte: since } } : {}),
      },
      include: { market: { select: { id: true, name: true } } },
      orderBy: { closedAt: "asc" },
    });

    // KPIs.
    const totalTrades = trades.length;
    const totalPnL = trades.reduce((s, t) => s + t.profitLoss, 0);
    const profitTrades = trades.filter((t) => t.profitLoss > 0);
    const lossTrades = trades.filter((t) => t.profitLoss < 0);
    const winRate = totalTrades > 0 ? profitTrades.length / totalTrades : 0;
    const avgWin =
      profitTrades.length > 0
        ? profitTrades.reduce((s, t) => s + t.profitLoss, 0) / profitTrades.length
        : 0;
    const avgLoss =
      lossTrades.length > 0
        ? lossTrades.reduce((s, t) => s + t.profitLoss, 0) / lossTrades.length
        : 0;
    const expectancy = totalTrades > 0 ? totalPnL / totalTrades : 0;

    // Cumulative P&L series — one point per trade, plus an implicit origin
    // so the chart anchors at zero. Cap the series at 1000 points to keep
    // the response reasonable at high trade counts (down-sample after).
    let running = 0;
    const cumulativePnL = trades
      .filter((t) => t.closedAt !== null)
      .map((t) => {
        running += t.profitLoss;
        return {
          at: t.closedAt!.toISOString(),
          pnl: running,
          tradeId: t.id,
        };
      });
    const downsampled = downsample(cumulativePnL, 1000);

    // Exit reason breakdown.
    const byReason = new Map<string, { count: number; totalPnL: number }>();
    for (const t of trades) {
      const r = t.exitReason ?? "unknown";
      const agg = byReason.get(r) ?? { count: 0, totalPnL: 0 };
      agg.count += 1;
      agg.totalPnL += t.profitLoss;
      byReason.set(r, agg);
    }
    const exitReasons = Array.from(byReason.entries())
      .map(([reason, v]) => ({
        reason,
        count: v.count,
        totalPnL: v.totalPnL,
        avgPnL: v.count > 0 ? v.totalPnL / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Best / worst markets. Requires at least 2 trades on a market to
    // qualify — a single lucky scalp isn't a signal.
    const byMarket = new Map<string, { name: string; trades: number; totalPnL: number }>();
    for (const t of trades) {
      const agg = byMarket.get(t.marketId) ?? {
        name: t.market.name,
        trades: 0,
        totalPnL: 0,
      };
      agg.trades += 1;
      agg.totalPnL += t.profitLoss;
      byMarket.set(t.marketId, agg);
    }
    const marketList = Array.from(byMarket.entries())
      .map(([id, v]) => ({ id, ...v }))
      .filter((m) => m.trades >= 2);
    const bestMarkets = [...marketList].sort((a, b) => b.totalPnL - a.totalPnL).slice(0, 5);
    const worstMarkets = [...marketList].sort((a, b) => a.totalPnL - b.totalPnL).slice(0, 5);

    return NextResponse.json({
      mode,
      range,
      since: since?.toISOString() ?? null,
      kpis: {
        totalTrades,
        totalPnL,
        winRate,
        avgWin,
        avgLoss,
        expectancy,
        profitCount: profitTrades.length,
        lossCount: lossTrades.length,
        scratchCount: totalTrades - profitTrades.length - lossTrades.length,
      },
      cumulativePnL: downsampled,
      exitReasons,
      bestMarkets,
      worstMarkets,
    });
  } catch (err) {
    console.error("[api/trading/analytics] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Simple strided downsample — keeps first, last, and every Nth in between.
// Sufficient for a chart; if we ever need proper percentile aggregation
// we'll swap to an LTTB implementation.
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const stride = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}
