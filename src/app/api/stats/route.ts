import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [trainers, jockeys, bets, totalRaces] = await Promise.all([
      prisma.trainer.findMany({
        orderBy: { strikeRate14d: "desc" },
        take: 20,
      }),
      prisma.jockey.findMany({
        orderBy: { strikeRate14d: "desc" },
        take: 20,
      }),
      prisma.bet.findMany(),
      prisma.race.count(),
    ]);

    const resolvedBets = bets.filter((b) => b.outcome !== "pending");
    const wonBets = bets.filter((b) => b.outcome === "won");

    // Prediction accuracy: how often top-scored runner finished 1st
    const runnersWithScoresAndResults = await prisma.runner.findMany({
      where: {
        gamblekingScore: { not: null },
        finishPosition: { not: null },
      },
      include: { race: true },
    });

    // Group by race to find top-scored per race
    const raceGroups = new Map<string, typeof runnersWithScoresAndResults>();
    for (const r of runnersWithScoresAndResults) {
      const group = raceGroups.get(r.raceId) ?? [];
      group.push(r);
      raceGroups.set(r.raceId, group);
    }

    let correctPredictions = 0;
    let totalPredictions = 0;
    for (const [, runners] of raceGroups) {
      const topScored = runners.sort(
        (a, b) => (b.gamblekingScore ?? 0) - (a.gamblekingScore ?? 0)
      )[0];
      if (topScored) {
        totalPredictions++;
        if (topScored.finishPosition === 1) correctPredictions++;
      }
    }

    return NextResponse.json({
      trainers,
      jockeys,
      betting: {
        totalBets: bets.length,
        totalStaked: bets.reduce((sum, b) => sum + b.stake, 0),
        totalProfitLoss: bets.reduce((sum, b) => sum + (b.profitLoss ?? 0), 0),
        winRate:
          resolvedBets.length > 0
            ? (wonBets.length / resolvedBets.length) * 100
            : 0,
      },
      predictions: {
        totalRaces,
        racesWithResults: totalPredictions,
        correctPredictions,
        accuracy:
          totalPredictions > 0
            ? (correctPredictions / totalPredictions) * 100
            : 0,
      },
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
