/**
 * Historical data seeding script using rpscrape.
 *
 * Prerequisites:
 * 1. Run: ./scripts/setup-rpscrape.sh
 * 2. cd rpscrape
 * 3. python scripts/rpscrape.py -r gb -y 2020-2025
 * 4. python scripts/rpscrape.py -r ire -y 2020-2025
 *
 * Usage:
 *   npx tsx scripts/seed-historical.ts <path-to-csv-directory>
 *
 * Example:
 *   npx tsx scripts/seed-historical.ts ./rpscrape/data
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  normalizeGoing,
  mapHeaders,
  parseDistance,
  parseSpOdds,
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

/**
 * Get a field value from a CSV row by internal field name.
 * Returns empty string if the column doesn't exist in this CSV.
 */
function getField(
  values: string[],
  headerMap: Map<string, number>,
  fieldName: string,
): string {
  const idx = headerMap.get(fieldName);
  if (idx === undefined || idx >= values.length) return "";
  return values[idx] || "";
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

async function processCSVFile(
  filePath: string,
): Promise<{ processed: number; trainerWins: Map<string, WinAccum>; jockeyWins: Map<string, WinAccum> }> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length < 2) return { processed: 0, trainerWins: new Map(), jockeyWins: new Map() };

  // Map headers using flexible column mapping
  const rawHeaders = parseCSVLine(lines[0]);
  const headerMap = mapHeaders(rawHeaders);

  // Verify minimum required columns
  if (!headerMap.has("date") || !headerMap.has("course") || !headerMap.has("horse")) {
    console.warn(`  Skipping ${path.basename(filePath)}: missing required columns (date, course, horse)`);
    return { processed: 0, trainerWins: new Map(), jockeyWins: new Map() };
  }

  // Parse all data rows
  const allRows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    allRows.push(parseCSVLine(lines[i]));
  }

  // Group rows by race (date + course + time)
  const raceGroups = new Map<string, string[][]>();
  for (const values of allRows) {
    const date = getField(values, headerMap, "date");
    const course = getField(values, headerMap, "course");
    const time = getField(values, headerMap, "time");
    const key = `${date}-${course}-${time}`;
    const group = raceGroups.get(key) ?? [];
    group.push(values);
    raceGroups.set(key, group);
  }

  // In-memory accumulators
  const goingAccum = new Map<string, PrefAccum>();    // "horseId|going" → counts
  const distAccum = new Map<string, PrefAccum>();     // "horseId|band" → counts
  const courseAccum = new Map<string, PrefAccum>();   // "horseId|courseId" → counts
  const trainerWins = new Map<string, WinAccum>();    // trainerId → wins
  const jockeyWins = new Map<string, WinAccum>();     // jockeyId → wins

  let processed = 0;
  const startTime = Date.now();
  const totalRows = allRows.length;

  // Process each race group (no explicit transaction — SQLite auto-commits each
  // statement, and the real perf win is the in-memory preference accumulation)
  for (const [, raceRunners] of raceGroups) {
    try {
      const first = raceRunners[0];
      const date = getField(first, headerMap, "date");
      const courseName = getField(first, headerMap, "course");
      const horseName = getField(first, headerMap, "horse");

      if (!date || !courseName || !horseName) continue;

      const time = getField(first, headerMap, "time");
      const going = getField(first, headerMap, "going");
      const raceType = getField(first, headerMap, "race_type");
      const raceName = getField(first, headerMap, "race_name");
      const raceClass = getField(first, headerMap, "class");
      const distStr = getField(first, headerMap, "distance");
      const distanceFurlongs = parseDistance(distStr || "1m");
      const raceDate = new Date(date);

      const isFlat = raceType
        ? !raceType.toLowerCase().includes("hurdle") && !raceType.toLowerCase().includes("chase")
        : true;

      // Upsert course
      const course = await prisma.course.upsert({
        where: { name: courseName },
        update: {},
        create: {
          name: courseName,
          country: getCountry(courseName),
          courseType: raceType?.toLowerCase().includes("flat") ? "flat" : "dual",
        },
      });

      // Upsert race
      const externalId = `rps-${date}-${courseName}-${time}`.replace(/\s+/g, "-");
      const race = await prisma.race.upsert({
        where: { externalId },
        update: {},
        create: {
          externalId,
          date: raceDate,
          courseId: course.id,
          raceName: raceName || "Unknown Race",
          raceType: raceType?.toLowerCase().includes("hurdle")
            ? "hurdle"
            : raceType?.toLowerCase().includes("chase")
              ? "chase"
              : "flat",
          class: raceClass ? parseInt(raceClass) || null : null,
          distanceFurlongs,
          going: going || null,
          numRunners: raceRunners.length,
        },
      });

      // Process each runner
      for (const values of raceRunners) {
        const horse = getField(values, headerMap, "horse");
        if (!horse) continue;

        const trainerName = getField(values, headerMap, "trainer");
        const jockeyName = getField(values, headerMap, "jockey");
        const sire = getField(values, headerMap, "sire");
        const dam = getField(values, headerMap, "dam");
        const orStr = getField(values, headerMap, "official_rating");
        const spStr = getField(values, headerMap, "sp");
        const posStr = getField(values, headerMap, "position");
        const weightStr = getField(values, headerMap, "weight");
        const drawStr = getField(values, headerMap, "draw");
        const ageStr = getField(values, headerMap, "age");
        const sex = getField(values, headerMap, "sex");

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

        // Upsert horse (with sire-based ID for disambiguation)
        const horseId = generateHorseId(horse, sire);
        const horseRecord = await prisma.horse.upsert({
          where: { id: horseId },
          update: {
            age: ageStr ? parseInt(ageStr) || null : null,
            sex: sex || null,
            sire: sire || undefined,
            dam: dam || undefined,
            trainerId: trainerId || undefined,
          },
          create: {
            id: horseId,
            name: horse,
            age: ageStr ? parseInt(ageStr) || null : null,
            sex: sex || null,
            sire: sire || null,
            dam: dam || null,
            trainerId: trainerId || null,
          },
        });

        const finishPos = parseInt(posStr);
        const position = isNaN(finishPos) ? null : finishPos;
        const drawPos = parseInt(drawStr);
        const draw = isNaN(drawPos) ? null : drawPos;

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
            officialRating: orStr ? parseInt(orStr) || null : null,
            oddsSp: parseSpOdds(spStr),
            finishPosition: position,
            weightCarried: weightStr || null,
            drawPosition: draw,
          },
        });

        // Accumulate preferences in memory (only for finished runners)
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

        // Progress logging
        if (processed % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const pct = ((processed / totalRows) * 100).toFixed(1);
          console.log(`  ${processed}/${totalRows} runners (${pct}%) — ${elapsed}s elapsed`);
        }
      }
    } catch (error) {
      console.error(`Error processing race group:`, error);
    }
  }

  // Bulk write accumulated going preferences
  for (const [key, accum] of goingAccum) {
    const [horseId, going] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.goingPreference.upsert({
      where: { horseId_going: { horseId, going } },
      update: { runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
      create: { horseId, going, runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
    });
  }

  // Bulk write accumulated distance preferences
  for (const [key, accum] of distAccum) {
    const [horseId, distanceBand] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.distancePreference.upsert({
      where: { horseId_distanceBand: { horseId, distanceBand } },
      update: { runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
      create: { horseId, distanceBand, runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
    });
  }

  // Bulk write accumulated course form
  for (const [key, accum] of courseAccum) {
    const [horseId, courseId] = key.split("|");
    const winPct = accum.runs > 0 ? (accum.wins / accum.runs) * 100 : 0;
    await prisma.courseForm.upsert({
      where: { horseId_courseId: { horseId, courseId } },
      update: { runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
      create: { horseId, courseId, runs: accum.runs, wins: accum.wins, places: accum.places, winPct },
    });
  }

  return { processed, trainerWins, jockeyWins };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const csvDir = process.argv[2];

  if (!csvDir) {
    console.log("Usage: npx tsx scripts/seed-historical.ts <path-to-csv-directory>");
    console.log("");
    console.log("Steps:");
    console.log("  1. ./scripts/setup-rpscrape.sh");
    console.log("  2. cd rpscrape");
    console.log("  3. python scripts/rpscrape.py -r gb -y 2020-2025");
    console.log("  4. python scripts/rpscrape.py -r ire -y 2020-2025");
    console.log("  5. cd .. && npm run db:seed -- ./rpscrape/data");
    process.exit(1);
  }

  const resolvedDir = path.resolve(csvDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  // Find CSV files (also check subdirectories one level deep)
  let csvFiles: string[] = [];
  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(resolvedDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".csv")) {
      csvFiles.push(fullPath);
    } else if (entry.isDirectory()) {
      const subFiles = fs.readdirSync(fullPath)
        .filter((f) => f.endsWith(".csv"))
        .map((f) => path.join(fullPath, f));
      csvFiles.push(...subFiles);
    }
  }

  if (csvFiles.length === 0) {
    console.error("No CSV files found in directory (or one level of subdirectories).");
    process.exit(1);
  }

  console.log(`Found ${csvFiles.length} CSV files to process`);

  let totalProcessed = 0;
  const totalStart = Date.now();
  // Accumulate trainer/jockey wins across ALL files for idempotent write
  const allTrainerWins = new Map<string, WinAccum>();
  const allJockeyWins = new Map<string, WinAccum>();

  for (const file of csvFiles) {
    console.log(`Processing: ${path.basename(file)}`);
    const { processed, trainerWins, jockeyWins } = await processCSVFile(file);
    totalProcessed += processed;
    // Merge wins
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
    console.log(`  -> ${processed} runners imported`);
  }

  // Write trainer/jockey win totals (absolute values — idempotent on re-run)
  console.log("Writing trainer/jockey win counts...");
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

  // Print summary stats
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
