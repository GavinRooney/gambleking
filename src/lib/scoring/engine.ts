// ─── Scoring engine — orchestrates all factor modules ───────────────────────

import { prisma } from "@/lib/db";
import type { ScoringWeights } from "./config";
import { getWeights } from "./config";
import { scoreForm } from "./factors/form";
import { scoreGoing } from "./factors/going";
import { scoreDistance } from "./factors/distance";
import { scoreTrainer } from "./factors/trainer";
import { scoreJockey } from "./factors/jockey";
import { scoreCourse } from "./factors/course";
import { scoreClass } from "./factors/class";
import { scoreDraw } from "./factors/draw";
import { scoreCombo } from "./factors/combo";
import { scoreMarket } from "./factors/market";
import { scoreWeather } from "./factors/weather";

// ─── Types ──────────────────────────────────────────────────────────────────

/** All the data the engine needs for a single runner, pre-fetched by the orchestrator. */
export interface RunnerData {
  runnerId: string;
  horseName: string;
  finishPositions: number[]; // last 5 results, most recent first (parsed from form string or DB)
  goingPreferences: { going: string; wins: number; runs: number; winPct: number }[];
  distancePreferences: { distanceBand: string; wins: number; runs: number; winPct: number }[];
  courseForm: { runs: number; wins: number; places: number } | null;
  trainerStrikeRate14d: number | null;
  jockeyStrikeRate14d: number | null;
  officialRating: number | null;
  typicalClass: number | null;
  drawPosition: number | null;
  marketRank: number | null;
  comboStats: { runs: number; wins: number } | null;
}

export interface RaceData {
  raceId: string;
  raceType: string;
  going: string | null;
  distanceFurlongs: number;
  raceClass: number | null;
  numRunners: number | null;
  drawBiasDataJson: string | null;
  weatherForecast: string | null;
  averageFieldRating: number | null;
}

export interface FactorBreakdown {
  recentForm: number;
  goingPreference: number;
  distanceSuitability: number;
  trainerForm: number;
  jockeyForm: number;
  courseForm: number;
  classChange: number;
  drawPosition: number;
  trainerJockeyCombo: number;
  marketPosition: number;
  weatherImpact: number;
}

export interface ScoredRunner {
  runnerId: string;
  horseName: string;
  totalScore: number;
  factors: FactorBreakdown;
  confidenceLevel?: string;
}

// ─── Core scoring ───────────────────────────────────────────────────────────

/**
 * Score a single runner using all factor modules.
 * Each factor returns 0-100, then is multiplied by its weight.
 * Final score is the sum (on a 0-100 scale since weights sum to ~1.0).
 */
export function scoreRunner(
  runner: RunnerData,
  race: RaceData,
  weights: ScoringWeights,
): ScoredRunner {
  const factors: FactorBreakdown = {
    recentForm: scoreForm(runner.finishPositions),
    goingPreference: scoreGoing(race.going, runner.goingPreferences),
    distanceSuitability: scoreDistance(race.distanceFurlongs, runner.distancePreferences),
    trainerForm: scoreTrainer(runner.trainerStrikeRate14d),
    jockeyForm: scoreJockey(runner.jockeyStrikeRate14d),
    courseForm: scoreCourse(runner.courseForm),
    classChange: scoreClass(
      race.raceClass,
      runner.typicalClass,
      runner.officialRating,
      race.averageFieldRating,
    ),
    drawPosition: scoreDraw(
      race.raceType,
      runner.drawPosition,
      race.numRunners,
      race.drawBiasDataJson,
      race.going,
    ),
    trainerJockeyCombo: scoreCombo(runner.comboStats),
    marketPosition: scoreMarket(runner.marketRank),
    weatherImpact: scoreWeather(race.weatherForecast, race.going, runner.goingPreferences),
  };

  const totalScore =
    factors.recentForm * weights.recentForm +
    factors.goingPreference * weights.goingPreference +
    factors.distanceSuitability * weights.distanceSuitability +
    factors.trainerForm * weights.trainerForm +
    factors.jockeyForm * weights.jockeyForm +
    factors.courseForm * weights.courseForm +
    factors.classChange * weights.classChange +
    factors.drawPosition * weights.drawPosition +
    factors.trainerJockeyCombo * weights.trainerJockeyCombo +
    factors.marketPosition * weights.marketPosition +
    factors.weatherImpact * weights.weatherImpact;

  return {
    runnerId: runner.runnerId,
    horseName: runner.horseName,
    totalScore: Math.round(totalScore * 100) / 100,
    factors,
  };
}

// ─── Race scoring (DB orchestrator) ─────────────────────────────────────────

/**
 * Score all runners in a single race and persist results to the database.
 * Returns scored runners sorted by total score descending.
 */
export async function scoreRace(raceId: string): Promise<ScoredRunner[]> {
  // 1. Fetch the race with all runners and related data
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      course: true,
      runners: {
        include: {
          horse: {
            include: {
              goingPreferences: true,
              distancePreferences: true,
              courseForm: true,
            },
          },
          jockey: true,
          trainer: true,
        },
      },
    },
  });

  if (!race) throw new Error(`Race not found: ${raceId}`);

  const weights = getWeights(race.raceType);

  // Compute average official rating across the field
  const ratings = race.runners
    .map((r) => r.officialRating)
    .filter((r): r is number => r != null);
  const averageFieldRating =
    ratings.length > 0
      ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
      : null;

  // 2. Fetch recent form for each horse (last 5 finish positions across past races)
  const runnerDataList: RunnerData[] = await Promise.all(
    race.runners.map(async (runner) => {
      // Try to get form from stored form string (from API), falling back to DB history
      const formComment = await prisma.raceComment.findFirst({
        where: {
          horseId: runner.horseId,
          source: "form",
        },
        orderBy: { raceDate: "desc" },
      });

      let finishPositions: number[];
      if (formComment) {
        finishPositions = parseFormString(formComment.comment);
      } else {
        // Fallback: get from DB past races
        const pastRunners = await prisma.runner.findMany({
          where: {
            horseId: runner.horseId,
            raceId: { not: raceId },
            finishPosition: { not: null },
          },
          orderBy: { race: { date: "desc" } },
          take: 5,
          select: { finishPosition: true },
        });
        finishPositions = pastRunners
          .map((r) => r.finishPosition)
          .filter((p): p is number => p != null);
      }

      // Course form for this specific course
      const courseForm = runner.horse.courseForm.find(
        (cf) => cf.courseId === race.courseId,
      ) ?? null;

      // Trainer/jockey combo stats — count past wins together
      const comboStats = await getComboStats(runner.trainerId, runner.jockeyId);

      return {
        runnerId: runner.id,
        horseName: runner.horse.name,
        finishPositions,
        goingPreferences: runner.horse.goingPreferences.map((gp) => ({
          going: gp.going,
          wins: gp.wins,
          runs: gp.runs,
          winPct: gp.winPct,
        })),
        distancePreferences: runner.horse.distancePreferences.map((dp) => ({
          distanceBand: dp.distanceBand,
          wins: dp.wins,
          runs: dp.runs,
          winPct: dp.winPct,
        })),
        courseForm: courseForm
          ? { runs: courseForm.runs, wins: courseForm.wins, places: courseForm.places }
          : null,
        trainerStrikeRate14d: runner.trainer?.strikeRate14d ?? null,
        jockeyStrikeRate14d: runner.jockey?.strikeRate14d ?? null,
        officialRating: runner.officialRating,
        typicalClass: null, // TODO: compute from past race classes if needed
        drawPosition: runner.drawPosition,
        marketRank: runner.marketRank,
        comboStats,
      };
    }),
  );

  const raceData: RaceData = {
    raceId: race.id,
    raceType: race.raceType,
    going: race.going,
    distanceFurlongs: race.distanceFurlongs,
    raceClass: race.class,
    numRunners: race.numRunners ?? race.runners.length,
    drawBiasDataJson: race.course.drawBiasData,
    weatherForecast: race.weatherForecast,
    averageFieldRating,
  };

  // 3. Score each runner
  const scored = runnerDataList.map((rd) => scoreRunner(rd, raceData, weights));

  // 4. Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // 5. Assign confidence levels based on gap between 1st and 2nd
  if (scored.length >= 2) {
    const gap = scored[0].totalScore - scored[1].totalScore;
    let confidence: string;
    if (gap >= 15) confidence = "strong";
    else if (gap >= 8) confidence = "moderate";
    else confidence = "speculative";

    // Apply confidence to all runners (it's a race-level property)
    for (const s of scored) {
      s.confidenceLevel = confidence;
    }
  } else if (scored.length === 1) {
    scored[0].confidenceLevel = "strong";
  }

  // 6. Persist scores to DB
  await Promise.all(
    scored.map((s) =>
      prisma.runner.update({
        where: { id: s.runnerId },
        data: {
          gamblekingScore: s.totalScore,
          confidenceLevel: s.confidenceLevel ?? null,
        },
      }),
    ),
  );

  return scored;
}

/**
 * Score all races for a given date.
 */
export async function scoreAllRaces(date: Date): Promise<Map<string, ScoredRunner[]>> {
  // Build date range for the target day (start of day to end of day)
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const races = await prisma.race.findMany({
    where: {
      date: { gte: startOfDay, lte: endOfDay },
    },
    select: { id: true },
  });

  const results = new Map<string, ScoredRunner[]>();

  for (const race of races) {
    const scored = await scoreRace(race.id);
    results.set(race.id, scored);
  }

  return results;
}

// ─── Form string parser ─────────────────────────────────────────────────────

/**
 * Parse a Racing Post-style form string like "9552-1" or "1/312/0" into
 * an array of finish positions (most recent last in the string, but we reverse).
 * Characters: digits = position, 0 = 10+, F = fell, P = pulled up, U = unseated, - = separator
 */
function parseFormString(form: string | null): number[] {
  if (!form || form.trim() === "") return [];
  const positions: number[] = [];
  for (const ch of form) {
    if (ch >= "1" && ch <= "9") {
      positions.push(parseInt(ch));
    } else if (ch === "0") {
      positions.push(10); // 0 means finished 10th or worse
    }
    // Skip separators (-/), falls (F), pulled up (P), etc.
  }
  // Form string reads left-to-right = oldest to newest, reverse for newest first
  return positions.reverse();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute trainer+jockey combo stats by counting how many times they've been
 * paired together, and how many of those runners won.
 */
async function getComboStats(
  trainerId: string | null,
  jockeyId: string | null,
): Promise<{ runs: number; wins: number } | null> {
  if (!trainerId || !jockeyId) return null;

  const combos = await prisma.runner.findMany({
    where: {
      trainerId,
      jockeyId,
      finishPosition: { not: null },
    },
    select: { finishPosition: true },
  });

  if (combos.length === 0) return null;

  return {
    runs: combos.length,
    wins: combos.filter((c) => c.finishPosition === 1).length,
  };
}
