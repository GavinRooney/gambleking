// GET /api/trading/sessions — recent trading sessions, newest first.
//
// The active session appears first (if there is one). Stats come straight
// from the row itself — they're kept in sync by the event-driven tracking
// in session.ts, so this query is cheap.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "100", 10) || 100, 1), 500);

    const sessions = await prisma.tradingSession.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return NextResponse.json(
      sessions.map((s) => ({
        id: s.id,
        mode: s.mode,
        date: s.date.toISOString(),
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        suspendedAt: s.suspendedAt?.toISOString() ?? null,
        durationMs:
          (s.endedAt ? s.endedAt.getTime() : Date.now()) - s.startedAt.getTime(),
        dailyPnL: s.dailyPnL,
        tradesOpened: s.tradesOpened,
        tradesClosed: s.tradesClosed,
        active: s.endedAt === null,
      }))
    );
  } catch (err) {
    console.error("[api/trading/sessions] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
