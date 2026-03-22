// ─── Best bet race identification ───────────────────────────────────────────

import { prisma } from "@/lib/db";
import { scoreRace } from "./engine";
import type { ScoredRunner } from "./engine";

export interface BestBet {
  race: {
    id: string;
    raceName: string;
    raceType: string;
    date: string;
    distanceFurlongs: number;
    going: string | null;
    class: number | null;
    numRunners: number | null;
    course: { name: string; country: string };
  };
  topRunner: {
    id: string;
    gamblekingScore: number | null;
    confidenceLevel: string | null;
    oddsBest: number | null;
    horse: { name: string; id: string };
    jockey: { name: string } | null;
    trainer: { name: string } | null;
  };
  scoreGap: number;
  reasons: string[];
}

/**
 * Find the best bet races for a given date.
 *
 * Uses a tiered approach:
 * - Score all races for the day
 * - Rank by score gap between 1st and 2nd
 * - Apply soft criteria to build reasons list
 * - Return top picks sorted by gap
 */
export async function getBestBets(date: Date): Promise<BestBet[]> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const races = await prisma.race.findMany({
    where: {
      date: { gte: startOfDay, lte: endOfDay },
    },
    include: {
      course: true,
      runners: {
        include: {
          horse: true,
          jockey: true,
          trainer: true,
        },
        orderBy: { gamblekingScore: "desc" },
      },
    },
  });

  const bestBets: BestBet[] = [];

  for (const race of races) {
    if (race.runners.length < 2) continue;

    // Ensure race is scored
    let scored: ScoredRunner[];
    if (race.runners[0].gamblekingScore === null) {
      scored = await scoreRace(race.id);
    } else {
      // Already scored — reconstruct from DB
      scored = race.runners
        .filter((r) => r.gamblekingScore !== null)
        .map((r) => ({
          runnerId: r.id,
          horseName: r.horse.name,
          totalScore: r.gamblekingScore!,
          factors: {
            recentForm: 50,
            goingPreference: 50,
            distanceSuitability: 50,
            trainerForm: 50,
            jockeyForm: 50,
            courseForm: 50,
            classChange: 50,
            drawPosition: 50,
            trainerJockeyCombo: 50,
            marketPosition: 50,
            weatherImpact: 50,
          },
          confidenceLevel: r.confidenceLevel ?? undefined,
        }));
    }

    if (scored.length < 2) continue;

    const top = scored[0];
    const second = scored[1];
    const gap = top.totalScore - second.totalScore;

    // Minimum gap of 2 points to qualify
    if (gap < 2) continue;

    // Build reasons
    const reasons: string[] = [];
    const topRunner = race.runners.find((r) => r.id === top.runnerId);
    if (!topRunner) continue;

    // Gap-based reason
    if (gap >= 15) reasons.push("Dominant score advantage");
    else if (gap >= 8) reasons.push("Clear score leader");
    else if (gap >= 4) reasons.push("Score edge");

    // Small field
    if (race.runners.length <= 6) reasons.push(`Small field (${race.runners.length} runners)`);
    else if (race.runners.length <= 8) reasons.push("Manageable field size");

    // Form-based reasons
    if (top.factors.recentForm >= 80) reasons.push("Strong recent form");
    else if (top.factors.recentForm >= 65) reasons.push("Good recent form");

    // Trainer form
    if (top.factors.trainerForm >= 70) reasons.push("Trainer in form");

    // Jockey form
    if (top.factors.jockeyForm >= 70) reasons.push("Jockey in form");

    // Class drop
    if (top.factors.classChange >= 80) reasons.push("Class drop");

    // Going preference
    if (top.factors.goingPreference >= 70) reasons.push("Going suits");

    // Course form
    if (top.factors.courseForm >= 70) reasons.push("Course form");

    // Market position
    if (top.factors.marketPosition >= 80) reasons.push("Market favourite");

    // Combo
    if (top.factors.trainerJockeyCombo >= 70) reasons.push("Proven trainer/jockey combo");

    bestBets.push({
      race: {
        id: race.id,
        raceName: race.raceName,
        raceType: race.raceType,
        date: race.date.toISOString(),
        distanceFurlongs: race.distanceFurlongs,
        going: race.going,
        class: race.class,
        numRunners: race.numRunners ?? race.runners.length,
        course: { name: race.course.name, country: race.course.country },
      },
      topRunner: {
        id: topRunner.id,
        gamblekingScore: top.totalScore,
        confidenceLevel: top.confidenceLevel ?? null,
        oddsBest: topRunner.oddsBest,
        horse: { name: topRunner.horse.name, id: topRunner.horse.id },
        jockey: topRunner.jockey ? { name: topRunner.jockey.name } : null,
        trainer: topRunner.trainer ? { name: topRunner.trainer.name } : null,
      },
      scoreGap: Math.round(gap * 10) / 10,
      reasons,
    });
  }

  // Sort by score gap descending
  bestBets.sort((a, b) => b.scoreGap - a.scoreGap);

  return bestBets;
}
