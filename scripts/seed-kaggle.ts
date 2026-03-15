/**
 * Import Kaggle horse racing dataset into GambleKing.
 *
 * Dataset: https://www.kaggle.com/datasets/hwaitt/horse-racing
 * Format: Two CSVs per year - races_YYYY.csv and horses_YYYY.csv, joined on `rid`.
 *
 * Usage:
 *   npx tsx scripts/seed-kaggle.ts <path-to-archive-dir> [startYear] [endYear]
 *
 * Examples:
 *   npx tsx scripts/seed-kaggle.ts ./archive           # All years (1990-2020)
 *   npx tsx scripts/seed-kaggle.ts ./archive 2015 2020 # 2015-2020 only
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  normalizeGoing,
  parseDistance,
  getDistanceBand,
  getCountry,
  generateHorseId,
} from "./seed-utils";

const prisma = new PrismaClient();

// ─── CSV parsing ────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }

  return rows;
}

// ─── Kaggle-specific parsers ────────────────────────────────────────────────

function parseKaggleDate(dateStr: string): Date | null {
  // Format: "20/01/01" (YY/MM/DD)
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]) + 2000;
  // Handle 1990s: years > 90 are 19xx
  const fullYear = year > 2090 ? year - 100 : year;
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  return new Date(fullYear, month, day);
}

function parseKaggleDistance(distStr: string): number {
  // Kaggle uses format like "1m2f", "6f", "2m" etc — same as rpscrape
  return parseDistance(distStr || "1m");
}

function parseKagglePosition(posStr: string): number | null {
  const pos = parseFloat(posStr);
  if (isNaN(pos) || pos >= 40) return null; // 40 = didn't finish
  return Math.round(pos);
}

function parseKaggleOdds(decimalPriceStr: string): number | null {
  // Kaggle stores 1/decimalPrice (i.e. probability), we need decimal odds
  const prob = parseFloat(decimalPriceStr);
  if (isNaN(prob) || prob <= 0 || prob >= 1) return null;
  return 1 / prob;
}

function parseKaggleRaceType(raceData: Record<string, string>): string {
  const condition = (raceData.condition || "").toLowerCase();
  const title = (raceData.title || "").toLowerCase();
  const hurdles = raceData.hurdles || "";

  if (title.includes("chase") || condition.includes("chase")) return "chase";
  if (hurdles || title.includes("hurdle") || condition.includes("hurdle")) return "hurdle";
  return "flat";
}

// ─── Accumulator types ──────────────────────────────────────────────────────

interface PrefAccum {
  runs: number;
  wins: number;
  places: number;
}

interface WinAccum {
  flatWins: number;
  hurdleWins: number;
}

// ─── Main processing ────────────────────────────────────────────────────────

async function processYear(
  archiveDir: string,
  year: number,
): Promise<{ processed: number; trainerWins: Map<string, WinAccum>; jockeyWins: Map<string, WinAccum> }> {
  const racesFile = path.join(archiveDir, `races_${year}.csv`);
  const horsesFile = path.join(archiveDir, `horses_${year}.csv`);

  if (!fs.existsSync(racesFile) || !fs.existsSync(horsesFile)) {
    console.warn(`  Missing files for ${year}, skipping`);
    return { processed: 0, trainerWins: new Map(), jockeyWins: new Map() };
  }

  console.log(`  Loading races...`);
  const raceRows = parseCSV(racesFile);
  console.log(`  Loading horses...`);
  const horseRows = parseCSV(horsesFile);

  // Build race lookup by rid
  const raceLookup = new Map<string, Record<string, string>>();
  for (const race of raceRows) {
    raceLookup.set(race.rid, race);
  }

  // Group horses by rid
  const raceGroups = new Map<string, Record<string, string>[]>();
  for (const horse of horseRows) {
    const group = raceGroups.get(horse.rid) ?? [];
    group.push(horse);
    raceGroups.set(horse.rid, group);
  }

  // In-memory accumulators
  const goingAccum = new Map<string, PrefAccum>();
  const distAccum = new Map<string, PrefAccum>();
  const courseAccum = new Map<string, PrefAccum>();
  const trainerWins = new Map<string, WinAccum>();
  const jockeyWins = new Map<string, WinAccum>();

  let processed = 0;
  const startTime = Date.now();
  const totalRunners = horseRows.length;

  for (const [rid, runners] of raceGroups) {
    const raceData = raceLookup.get(rid);
    if (!raceData) continue;

    const courseName = raceData.course;
    const dateStr = raceData.date;
    if (!courseName || !dateStr) continue;

    // Only UK and Ireland
    const countryCode = raceData.countryCode || "";
    if (countryCode && countryCode !== "GB" && countryCode !== "IRE") continue;

    const raceDate = parseKaggleDate(dateStr);
    if (!raceDate) continue;

    const going = raceData.condition || "";
    const raceType = parseKaggleRaceType(raceData);
    const distanceFurlongs = parseKaggleDistance(raceData.distance);
    const isFlat = raceType === "flat";

    try {
      // Upsert course
      const country = countryCode === "IRE" ? "IRE" : getCountry(courseName);
      const course = await prisma.course.upsert({
        where: { name: courseName },
        update: {},
        create: {
          name: courseName,
          country,
          courseType: isFlat ? "flat" : "dual",
        },
      });

      // Upsert race
      const externalId = `kaggle-${rid}`;
      const raceClass = raceData.class ? parseInt(raceData.class) || null : null;
      const race = await prisma.race.upsert({
        where: { externalId },
        update: {},
        create: {
          externalId,
          date: raceDate,
          courseId: course.id,
          raceName: raceData.title || "Unknown Race",
          raceType,
          class: raceClass,
          distanceFurlongs,
          going: going || null,
          numRunners: runners.length,
        },
      });

      // Process runners
      for (const runner of runners) {
        const horseName = runner.horseName;
        if (!horseName) continue;

        const trainerName = runner.trainerName || "";
        const jockeyName = runner.jockeyName || "";
        const sire = runner.father || "";
        const dam = runner.mother || "";

        // Upsert trainer
        let trainerId: string | undefined;
        if (trainerName) {
          const trainer = await prisma.trainer.upsert({
            where: { name: trainerName },
            update: {},
            create: { name: trainerName },
          });
          trainerId = trainer.id;
        }

        // Upsert jockey
        let jockeyId: string | undefined;
        if (jockeyName) {
          const jockey = await prisma.jockey.upsert({
            where: { name: jockeyName },
            update: {},
            create: { name: jockeyName },
          });
          jockeyId = jockey.id;
        }

        // Upsert horse
        const horseId = generateHorseId(horseName, sire);
        const age = runner.age ? parseInt(runner.age) || null : null;
        const horseRecord = await prisma.horse.upsert({
          where: { id: horseId },
          update: {
            age,
            sire: sire || undefined,
            dam: dam || undefined,
            trainerId: trainerId || undefined,
          },
          create: {
            id: horseId,
            name: horseName,
            age,
            sire: sire || null,
            dam: dam || null,
            trainerId: trainerId || null,
          },
        });

        const position = parseKagglePosition(runner.position);
        const drawPos = runner.saddle ? parseInt(runner.saddle) || null : null;
        const or = runner.OR ? parseInt(runner.OR) || null : null;
        const oddsSp = parseKaggleOdds(runner.decimalPrice);

        // Weight: Kaggle has weightSt and weightLb
        const weightStr = runner.weightSt && runner.weightLb
          ? `${runner.weightSt}-${runner.weightLb}`
          : null;

        // Upsert runner
        await prisma.runner.upsert({
          where: {
            raceId_horseId: { raceId: race.id, horseId: horseRecord.id },
          },
          update: { finishPosition: position },
          create: {
            raceId: race.id,
            horseId: horseRecord.id,
            jockeyId: jockeyId || null,
            trainerId: trainerId || null,
            officialRating: or,
            oddsSp,
            finishPosition: position,
            weightCarried: weightStr,
            drawPosition: drawPos,
          },
        });

        // Accumulate preferences (only for finished runners)
        if (position !== null) {
          const won = position === 1;
          const placed = position <= 3;

          // Going preference
          if (going) {
            const goingNorm = normalizeGoing(going);
            const gKey = `${horseRecord.id}|${goingNorm}`;
            const g = goingAccum.get(gKey) ?? { runs: 0, wins: 0, places: 0 };
            g.runs++;
            if (won) g.wins++;
            if (placed) g.places++;
            goingAccum.set(gKey, g);
          }

          // Distance preference
          const band = getDistanceBand(distanceFurlongs);
          const dKey = `${horseRecord.id}|${band}`;
          const d = distAccum.get(dKey) ?? { runs: 0, wins: 0, places: 0 };
          d.runs++;
          if (won) d.wins++;
          if (placed) d.places++;
          distAccum.set(dKey, d);

          // Course form
          const cKey = `${horseRecord.id}|${course.id}`;
          const c = courseAccum.get(cKey) ?? { runs: 0, wins: 0, places: 0 };
          c.runs++;
          if (won) c.wins++;
          if (placed) c.places++;
          courseAccum.set(cKey, c);

          // Trainer/jockey win counts
          if (trainerId && won) {
            const tw = trainerWins.get(trainerId) ?? { flatWins: 0, hurdleWins: 0 };
            if (isFlat) tw.flatWins++;
            else tw.hurdleWins++;
            trainerWins.set(trainerId, tw);
          }
          if (jockeyId && won) {
            const jw = jockeyWins.get(jockeyId) ?? { flatWins: 0, hurdleWins: 0 };
            if (isFlat) jw.flatWins++;
            else jw.hurdleWins++;
            jockeyWins.set(jockeyId, jw);
          }
        }

        processed++;

        if (processed % 5000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const pct = ((processed / totalRunners) * 100).toFixed(1);
          console.log(`  ${processed}/${totalRunners} runners (${pct}%) — ${elapsed}s elapsed`);
        }
      }
    } catch (error) {
      console.error(`  Error processing race ${rid}:`, error);
    }
  }

  // Bulk write accumulated preferences
  console.log(`  Writing going preferences (${goingAccum.size} entries)...`);
  for (const [key, accum] of goingAccum) {
    const [horseId, going] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.goingPreference.upsert({
      where: { horseId_going: { horseId, going } },
      update: { runs: { increment: accum.runs }, wins: { increment: accum.wins }, places: { increment: accum.places }, winPct },
      create: { horseId, going, ...accum, winPct },
    });
  }

  console.log(`  Writing distance preferences (${distAccum.size} entries)...`);
  for (const [key, accum] of distAccum) {
    const [horseId, distanceBand] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.distancePreference.upsert({
      where: { horseId_distanceBand: { horseId, distanceBand } },
      update: { runs: { increment: accum.runs }, wins: { increment: accum.wins }, places: { increment: accum.places }, winPct },
      create: { horseId, distanceBand, ...accum, winPct },
    });
  }

  console.log(`  Writing course form (${courseAccum.size} entries)...`);
  for (const [key, accum] of courseAccum) {
    const [horseId, courseId] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.courseForm.upsert({
      where: { horseId_courseId: { horseId, courseId } },
      update: { runs: { increment: accum.runs }, wins: { increment: accum.wins }, places: { increment: accum.places }, winPct },
      create: { horseId, courseId, ...accum, winPct },
    });
  }

  return { processed, trainerWins, jockeyWins };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const archiveDir = process.argv[2];
  const startYear = parseInt(process.argv[3]) || 2015;
  const endYear = parseInt(process.argv[4]) || 2020;

  if (!archiveDir) {
    console.log("Usage: npx tsx scripts/seed-kaggle.ts <archive-dir> [startYear] [endYear]");
    console.log("Example: npx tsx scripts/seed-kaggle.ts ./archive 2015 2020");
    process.exit(1);
  }

  const resolvedDir = path.resolve(archiveDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  console.log(`Importing Kaggle data: ${startYear}-${endYear}`);

  let totalProcessed = 0;
  const totalStart = Date.now();
  const allTrainerWins = new Map<string, WinAccum>();
  const allJockeyWins = new Map<string, WinAccum>();

  for (let year = startYear; year <= endYear; year++) {
    console.log(`\n--- ${year} ---`);
    const { processed, trainerWins, jockeyWins } = await processYear(resolvedDir, year);
    totalProcessed += processed;

    for (const [id, wins] of trainerWins) {
      const existing = allTrainerWins.get(id) ?? { flatWins: 0, hurdleWins: 0 };
      existing.flatWins += wins.flatWins;
      existing.hurdleWins += wins.hurdleWins;
      allTrainerWins.set(id, existing);
    }
    for (const [id, wins] of jockeyWins) {
      const existing = allJockeyWins.get(id) ?? { flatWins: 0, hurdleWins: 0 };
      existing.flatWins += wins.flatWins;
      existing.hurdleWins += wins.hurdleWins;
      allJockeyWins.set(id, existing);
    }

    console.log(`  -> ${processed} runners imported for ${year}`);
  }

  // Write trainer/jockey win totals
  console.log("\nWriting trainer/jockey win counts...");
  for (const [trainerId, wins] of allTrainerWins) {
    await prisma.trainer.update({
      where: { id: trainerId },
      data: { flatWins: wins.flatWins, hurdleWins: wins.hurdleWins },
    });
  }
  for (const [jockeyId, wins] of allJockeyWins) {
    await prisma.jockey.update({
      where: { id: jockeyId },
      data: { flatWins: wins.flatWins, hurdleWins: wins.hurdleWins },
    });
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`\nDone! Total runners processed: ${totalProcessed} in ${totalElapsed}s`);

  const [horses, races, courses, trainers, jockeys] = await Promise.all([
    prisma.horse.count(),
    prisma.race.count(),
    prisma.course.count(),
    prisma.trainer.count(),
    prisma.jockey.count(),
  ]);

  console.log(`Database now contains:`);
  console.log(`  Horses:   ${horses}`);
  console.log(`  Races:    ${races}`);
  console.log(`  Courses:  ${courses}`);
  console.log(`  Trainers: ${trainers}`);
  console.log(`  Jockeys:  ${jockeys}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
