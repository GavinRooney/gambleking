// GET /api/trading/markets — list of currently tracked markets for the
// dashboard. Excludes markets that have passed final status ("closed") so
// the UI doesn't accumulate history here — analytics has its own query.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await prisma.tradingMarket.findMany({
      where: { status: { in: ["scanning", "trading", "warned", "exited"] } },
      orderBy: { startTime: "asc" },
      include: {
        _count: { select: { runners: true, trades: true } },
        trades: {
          where: { status: "open" },
          select: { id: true },
        },
      },
    });
    return NextResponse.json(
      markets.map((m) => ({
        id: m.id,
        betfairMarketId: m.betfairMarketId,
        name: m.name,
        startTime: m.startTime.toISOString(),
        status: m.status,
        totalMatched: m.totalMatched,
        numRunners: m._count.runners || m.numRunners,
        totalTrades: m._count.trades,
        openTradeCount: m.trades.length,
      }))
    );
  } catch (err) {
    console.error("[api/trading/markets] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
