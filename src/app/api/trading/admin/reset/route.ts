// DELETE /api/trading/admin/reset — wipe all trading state and rebuild the
// mock client from scratch. Preserves StrategyConfig (user's tuned settings)
// and every predictor table.
//
// Refuses with 409 while a session is active — force the user to stopSession
// first so they don't accidentally destroy data mid-flight.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getActiveSession,
} from "@/lib/trading/engine/session";
import {
  getBetAngelClient,
  resetBetAngelClientCache,
} from "@/lib/trading/bet-angel";
import { MockBetAngelClient } from "@/lib/trading/bet-angel/mock-client";
import { resetRunnerHistory } from "@/lib/trading/engine/runner-selector";
import { resetConnectionState } from "@/lib/trading/risk/connection-failsafe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const active = await getActiveSession();
    if (active && active.endedAt === null) {
      return NextResponse.json(
        { error: "A session is currently active. Stop it before resetting data." },
        { status: 409 }
      );
    }

    // Wipe in FK-safe order: children first, parents last.
    await prisma.tradeOrder.deleteMany({});
    await prisma.trade.deleteMany({});
    await prisma.tradingRunner.deleteMany({});
    await prisma.tradingMarket.deleteMany({});
    await prisma.tradingSession.deleteMany({});

    // Clear in-process state that would otherwise survive the DB wipe.
    resetRunnerHistory();
    resetConnectionState();

    // If the current client is a MockBetAngelClient, reset its markets and
    // orders too. For non-mock clients (practice/live) there's nothing
    // local to reset — the real Bet Angel holds canonical state.
    const client = getBetAngelClient();
    if (client instanceof MockBetAngelClient) {
      client.reset();
    }
    // Drop the cached client so the next session rebuilds (important for
    // the mock, which auto-seeds markets on first use via the session API).
    resetBetAngelClientCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/trading/admin/reset] error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
