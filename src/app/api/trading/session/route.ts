// Trading session API.
//
//   GET    /api/trading/session — active session + mode + open trade count
//   POST   /api/trading/session — start a new session (mock-mode auto-seeds markets)
//   DELETE /api/trading/session — stop the active session

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBetAngelClient, getBetAngelMode } from "@/lib/trading/bet-angel";
import { MockBetAngelClient } from "@/lib/trading/bet-angel/mock-client";
import { seedMockMarkets } from "@/lib/trading/mock-seeder";
import {
  getActiveSession,
  startSession,
  stopSession,
} from "@/lib/trading/engine/session";

// Force Node runtime — we need Node timers, the Prisma client, and the
// in-process event bus to stick around.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusPayload = {
  mode: "mock" | "practice" | "live";
  active: boolean;
  session: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    dailyPnL: number;
    tradesOpened: number;
    tradesClosed: number;
    mode: string;
  } | null;
  openTradeCount: number;
  trackedMarketCount: number;
};

async function buildStatus(): Promise<StatusPayload> {
  const mode = getBetAngelMode();
  const session = await getActiveSession();
  const openTradeCount = session
    ? await prisma.trade.count({
        where: { sessionId: session.id, status: "open" },
      })
    : 0;
  const trackedMarketCount = await prisma.tradingMarket.count();
  return {
    mode,
    active: !!session && session.endedAt === null,
    session: session
      ? {
          id: session.id,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          dailyPnL: session.dailyPnL,
          tradesOpened: session.tradesOpened,
          tradesClosed: session.tradesClosed,
          mode: session.mode,
        }
      : null,
    openTradeCount,
    trackedMarketCount,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await buildStatus());
  } catch (err) {
    console.error("[api/trading/session] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const mode = getBetAngelMode();
    const client = getBetAngelClient();

    // In mock mode, lazily seed synthetic markets the first time a session
    // starts so the dashboard has something to show without an admin step.
    if (mode === "mock" && client instanceof MockBetAngelClient) {
      seedMockMarkets(client);
    }

    await startSession();
    return NextResponse.json(await buildStatus(), { status: 201 });
  } catch (err) {
    console.error("[api/trading/session] POST error", err);
    const msg = (err as Error).message;
    const status = /already active/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE() {
  try {
    await stopSession();
    return NextResponse.json(await buildStatus());
  } catch (err) {
    console.error("[api/trading/session] DELETE error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
