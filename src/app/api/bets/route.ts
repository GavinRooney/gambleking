import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");

  try {
    const bets = await prisma.bet.findMany({
      where: status ? { outcome: status } : undefined,
      include: {
        runner: {
          include: {
            horse: true,
            race: { include: { course: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const stats = {
      totalBets: bets.length,
      totalStaked: bets.reduce((sum, b) => sum + b.stake, 0),
      totalProfitLoss: bets.reduce((sum, b) => sum + (b.profitLoss ?? 0), 0),
      pendingCount: bets.filter((b) => b.outcome === "pending").length,
      wonCount: bets.filter((b) => b.outcome === "won").length,
      lostCount: bets.filter((b) => b.outcome === "lost").length,
    };

    return NextResponse.json({ bets, stats });
  } catch (error) {
    console.error("Failed to fetch bets:", error);
    return NextResponse.json(
      { error: "Failed to fetch bets" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runnerId, stake, oddsTaken, betType, notes } = body as {
      runnerId: string;
      stake: number;
      oddsTaken: number;
      betType: string;
      notes?: string;
    };

    if (!runnerId || !stake || !oddsTaken || !betType) {
      return NextResponse.json(
        { error: "Missing required fields: runnerId, stake, oddsTaken, betType" },
        { status: 400 }
      );
    }

    const runner = await prisma.runner.findUnique({ where: { id: runnerId } });
    if (!runner) {
      return NextResponse.json(
        { error: "Runner not found" },
        { status: 404 }
      );
    }

    const bet = await prisma.bet.create({
      data: {
        runnerId,
        stake,
        oddsTaken,
        betType,
        notes: notes || null,
      },
      include: {
        runner: {
          include: {
            horse: true,
            race: { include: { course: true } },
          },
        },
      },
    });

    return NextResponse.json(bet, { status: 201 });
  } catch (error) {
    console.error("Failed to create bet:", error);
    return NextResponse.json(
      { error: "Failed to create bet" },
      { status: 500 }
    );
  }
}
