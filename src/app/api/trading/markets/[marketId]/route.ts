// GET /api/trading/markets/[marketId] — single market detail with runners,
// their computed signals, and any open trades.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await context.params;
    const market = await prisma.tradingMarket.findUnique({
      where: { id: marketId },
      include: {
        runners: { orderBy: { selectionId: "asc" } },
        trades: {
          include: {
            orders: { orderBy: { createdAt: "asc" } },
            runner: { select: { horseName: true, selectionId: true } },
          },
          orderBy: { openedAt: "desc" },
          take: 50,
        },
      },
    });
    if (!market) {
      return NextResponse.json({ error: "market not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: market.id,
      betfairMarketId: market.betfairMarketId,
      name: market.name,
      startTime: market.startTime.toISOString(),
      status: market.status,
      totalMatched: market.totalMatched,
      numRunners: market.numRunners,
      runners: market.runners.map((r) => ({
        id: r.id,
        selectionId: r.selectionId,
        horseName: r.horseName,
        bestBack: r.bestBack,
        bestLay: r.bestLay,
        traded: r.traded,
        volatilityScore: r.volatilityScore,
        bookBalance: r.bookBalance,
      })),
      trades: market.trades.map((t) => ({
        id: t.id,
        status: t.status,
        runnerName: t.runner.horseName,
        runnerId: t.runnerId,
        stake: t.stake,
        entryBackPrice: t.entryBackPrice,
        entryLayPrice: t.entryLayPrice,
        profitLoss: t.profitLoss,
        exitReason: t.exitReason,
        mode: t.mode,
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
        orders: t.orders.map((o) => ({
          id: o.id,
          side: o.side,
          purpose: o.purpose,
          price: o.price,
          size: o.size,
          matchedSize: o.matchedSize,
          status: o.status,
        })),
      })),
    });
  } catch (err) {
    console.error("[api/trading/markets/[marketId]] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
