import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { fetchRaceCards, fetchResults } from "./racing-api";
import { fetchWeatherForCourse } from "./weather";
import type {
  RacingApiRaceCard,
  RacingApiResult,
  RacingApiRunner,
  NormalizedRace,
  NormalizedRunner,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeInt(val: string | undefined | null): number | null {
  if (val == null || val === "") return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? null : n;
}

function safeFloat(val: string | undefined | null): number | null {
  if (val == null || val === "") return null;
  const n = parseFloat(val);
  return Number.isNaN(n) ? null : n;
}

/**
 * Guess country from course name — simple heuristic.
 * Irish courses we know about get "IRE", everything else "UK".
 */
const IRISH_COURSES = new Set([
  "leopardstown",
  "curragh",
  "fairyhouse",
  "punchestown",
  "galway",
  "limerick",
  "navan",
  "cork",
  "dundalk",
  "tipperary",
  "wexford",
  "downpatrick",
  "kilbeggan",
  "listowel",
  "tramore",
  "clonmel",
  "ballinrobe",
  "roscommon",
  "sligo",
  "thurles",
  "naas",
  "gowran park",
  "bellewstown",
]);

function guessCountry(courseName: string): string {
  return IRISH_COURSES.has(courseName.toLowerCase()) ? "IRE" : "UK";
}

/** Map the Racing API `type` field to our DB raceType enum. */
function normalizeRaceType(apiType: string | undefined): string {
  const t = (apiType ?? "").toLowerCase();
  if (t.includes("hurdle")) return "hurdle";
  if (t.includes("chase")) return "chase";
  if (t.includes("nh flat") || t.includes("bumper")) return "bumper";
  return "flat";
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizeRunner(r: RacingApiRunner): NormalizedRunner {
  // ofr can be number or string like "-"
  const ofr = typeof r.ofr === "number" ? r.ofr : safeInt(String(r.ofr));

  return {
    horseName: r.horse ?? "Unknown",
    horseExternalId: r.horse_id ?? "",
    age: safeInt(r.age),
    sex: r.sex || null,
    sire: r.sire || null,
    dam: r.dam || null,
    trainerName: r.trainer || null,
    trainerExternalId: r.trainer_id || null,
    jockeyName: r.jockey || null,
    jockeyExternalId: r.jockey_id || null,
    owner: r.owner || null,
    weightCarried: r.lbs ? `${r.lbs}lbs` : null,
    officialRating: ofr,
    drawPosition: typeof r.draw === "number" ? r.draw : safeInt(String(r.draw)),
    form: r.form || null,
    trainerStrikeRate14d: r.trainer_14_days ? safeFloat(r.trainer_14_days.percent) : null,
    oddsSp: safeFloat(r.sp),
    oddsBest: null, // odds not available on basic plan racecards
    finishPosition: safeInt(r.position),
    beatenDistance: safeFloat(r.beaten_distance),
  };
}

function normalizeRace(
  card: RacingApiRaceCard | RacingApiResult
): NormalizedRace {
  // Combine date and off_time into a proper datetime
  const dateTime = card.off_dt
    ? new Date(card.off_dt)
    : new Date(`${card.date}T${card.off_time || "00:00"}:00`);

  // Parse class from "Class 1" format
  const classMatch = card.race_class?.match(/\d+/);

  return {
    externalId: card.race_id,
    date: dateTime,
    courseName: card.course ?? "Unknown",
    courseExternalId: card.course_id ?? "",
    raceName: card.race_name ?? "Unnamed Race",
    raceType: normalizeRaceType(card.type),
    raceClass: classMatch ? safeInt(classMatch[0]) : null,
    distanceFurlongs: safeFloat(card.distance_f) ?? 0,
    going: card.going || null,
    surface: card.surface || null,
    prizeMoney: safeInt(card.prize?.replace(/[^0-9]/g, "")),
    numRunners: safeInt(card.field_size),
    region: card.region || "GB",
    runners: (card.runners ?? []).map(normalizeRunner),
  };
}

// ─── Upsert helpers ──────────────────────────────────────────────────────────

async function upsertCourse(name: string, region?: string, surface?: string | null) {
  const country = region === "IRE" ? "IRE" : region === "GB" ? "UK" : guessCountry(name);
  return prisma.course.upsert({
    where: { name },
    create: { name, country, surface: surface || null },
    update: { surface: surface || undefined },
  });
}

async function upsertJockey(name: string) {
  return prisma.jockey.upsert({
    where: { name },
    create: { name },
    update: {},
  });
}

async function upsertTrainer(name: string, strikeRate14d?: number | null) {
  return prisma.trainer.upsert({
    where: { name },
    create: { name, strikeRate14d: strikeRate14d ?? null },
    update: strikeRate14d != null ? { strikeRate14d } : {},
  });
}

async function upsertHorse(runner: NormalizedRunner, trainerId: string | null) {
  // Use horseExternalId + horseName as a pragmatic unique key.
  // Prisma schema doesn't have a unique on Horse.name, so we do a
  // findFirst + create/update manually.
  const existing = await prisma.horse.findFirst({
    where: { name: runner.horseName },
  });

  if (existing) {
    return prisma.horse.update({
      where: { id: existing.id },
      data: {
        age: runner.age ?? existing.age,
        sex: runner.sex ?? existing.sex,
        sire: runner.sire ?? existing.sire,
        dam: runner.dam ?? existing.dam,
        owner: runner.owner ?? existing.owner,
        trainerId: trainerId ?? existing.trainerId,
      },
    });
  }

  return prisma.horse.create({
    data: {
      name: runner.horseName,
      age: runner.age,
      sex: runner.sex,
      sire: runner.sire,
      dam: runner.dam,
      owner: runner.owner,
      trainerId: trainerId,
    },
  });
}

// ─── Sync: Race Cards ────────────────────────────────────────────────────────

export interface SyncResult {
  races: number;
  runners: number;
  errors: number;
}

/**
 * Fetch race cards from the Racing API and upsert everything into the DB.
 * @param date  "today" | "tomorrow" | "YYYY-MM-DD"
 */
export async function syncRaceCards(
  date: "today" | "tomorrow" | string
): Promise<SyncResult> {
  const cards = await fetchRaceCards(date);
  const normalized = cards.map(normalizeRace);

  // Filter to UK & Ireland only
  const ukIreRaces = normalized.filter(
    (r) => r.region === "GB" || r.region === "IRE"
  );

  console.log(
    `[syncRaceCards] ${normalized.length} total races, ${ukIreRaces.length} UK/IRE`
  );

  let racesCount = 0;
  let runnersCount = 0;
  let errors = 0;

  for (const race of ukIreRaces) {
    try {
      // Course
      const course = await upsertCourse(race.courseName, race.region, race.surface);

      // Weather (fire-and-forget-ish, don't block on failure)
      const dateStr =
        date === "today"
          ? format(new Date(), "yyyy-MM-dd")
          : date === "tomorrow"
            ? format(new Date(Date.now() + 86_400_000), "yyyy-MM-dd")
            : date;

      let weatherJson: string | null = null;
      try {
        const weather = await fetchWeatherForCourse(race.courseName, dateStr);
        if (weather) weatherJson = JSON.stringify(weather);
      } catch {
        // Non-critical, continue
      }

      // Race upsert
      const dbRace = await prisma.race.upsert({
        where: { externalId: race.externalId },
        create: {
          externalId: race.externalId,
          date: race.date,
          courseId: course.id,
          raceName: race.raceName,
          raceType: race.raceType,
          class: race.raceClass,
          distanceFurlongs: race.distanceFurlongs,
          going: race.going,
          prizeMoney: race.prizeMoney,
          numRunners: race.numRunners,
          weatherForecast: weatherJson,
        },
        update: {
          going: race.going,
          numRunners: race.numRunners,
          weatherForecast: weatherJson,
        },
      });

      racesCount++;

      // Runners — assign market rank by position in the API list (1-indexed)
      for (let idx = 0; idx < race.runners.length; idx++) {
        const runner = race.runners[idx];
        const marketRank = idx + 1;
        try {
          // Related entities
          const trainer = runner.trainerName
            ? await upsertTrainer(runner.trainerName, runner.trainerStrikeRate14d)
            : null;

          const jockey = runner.jockeyName
            ? await upsertJockey(runner.jockeyName)
            : null;

          const horse = await upsertHorse(runner, trainer?.id ?? null);

          await prisma.runner.upsert({
            where: {
              raceId_horseId: {
                raceId: dbRace.id,
                horseId: horse.id,
              },
            },
            create: {
              raceId: dbRace.id,
              horseId: horse.id,
              jockeyId: jockey?.id ?? null,
              trainerId: trainer?.id ?? null,
              drawPosition: runner.drawPosition,
              weightCarried: runner.weightCarried,
              officialRating: runner.officialRating,
              oddsBest: runner.oddsBest,
              marketRank,
            },
            update: {
              jockeyId: jockey?.id ?? null,
              trainerId: trainer?.id ?? null,
              drawPosition: runner.drawPosition,
              weightCarried: runner.weightCarried,
              officialRating: runner.officialRating,
              oddsBest: runner.oddsBest,
              marketRank,
            },
          });

          // Store form string as a race comment for scoring engine access
          if (runner.form) {
            await prisma.raceComment.upsert({
              where: {
                id: `form-${horse.id}-${dbRace.id}`,
              },
              create: {
                id: `form-${horse.id}-${dbRace.id}`,
                horseId: horse.id,
                raceDate: race.date,
                course: race.courseName,
                comment: runner.form,
                source: "form",
              },
              update: {
                comment: runner.form,
              },
            });
          }

          runnersCount++;
        } catch (err) {
          console.error(
            `Error syncing runner "${runner.horseName}" in ${race.raceName}:`,
            err
          );
          errors++;
        }
      }
    } catch (err) {
      console.error(`Error syncing race "${race.raceName}":`, err);
      errors++;
    }
  }

  console.log(
    `[syncRaceCards] date=${date} | races=${racesCount} runners=${runnersCount} errors=${errors}`
  );
  return { races: racesCount, runners: runnersCount, errors };
}

// ─── Sync: Results ───────────────────────────────────────────────────────────

/**
 * Fetch results and update runner finish positions / beaten distances.
 * @param date  "today" | "YYYY-MM-DD"
 */
export async function syncResults(
  date: "today" | string
): Promise<SyncResult> {
  const results = await fetchResults(date);
  const normalized = results.map(normalizeRace);

  let racesCount = 0;
  let runnersCount = 0;
  let errors = 0;

  for (const race of normalized) {
    try {
      // Find existing race by externalId
      const dbRace = await prisma.race.findUnique({
        where: { externalId: race.externalId },
      });

      if (!dbRace) {
        // Race wasn't synced from cards yet — create it
        const course = await upsertCourse(race.courseName);
        const created = await prisma.race.create({
          data: {
            externalId: race.externalId,
            date: race.date,
            courseId: course.id,
            raceName: race.raceName,
            raceType: race.raceType,
            class: race.raceClass,
            distanceFurlongs: race.distanceFurlongs,
            going: race.going,
            prizeMoney: race.prizeMoney,
            numRunners: race.numRunners,
          },
        });

        racesCount++;

        // Insert runners with results
        for (const runner of race.runners) {
          try {
            const trainer = runner.trainerName
              ? await upsertTrainer(runner.trainerName)
              : null;
            const jockey = runner.jockeyName
              ? await upsertJockey(runner.jockeyName)
              : null;
            const horse = await upsertHorse(runner, trainer?.id ?? null);

            await prisma.runner.create({
              data: {
                raceId: created.id,
                horseId: horse.id,
                jockeyId: jockey?.id ?? null,
                trainerId: trainer?.id ?? null,
                drawPosition: runner.drawPosition,
                weightCarried: runner.weightCarried,
                officialRating: runner.officialRating,
                oddsSp: runner.oddsSp,
                oddsBest: runner.oddsBest,
                finishPosition: runner.finishPosition,
                beatenDistance: runner.beatenDistance,
              },
            });
            runnersCount++;
          } catch (err) {
            console.error(
              `Error creating runner "${runner.horseName}" in ${race.raceName}:`,
              err
            );
            errors++;
          }
        }
        continue;
      }

      // Race exists — update going in case it changed
      await prisma.race.update({
        where: { id: dbRace.id },
        data: { going: race.going },
      });
      racesCount++;

      // Update each runner's result
      for (const runner of race.runners) {
        try {
          const horse = await prisma.horse.findFirst({
            where: { name: runner.horseName },
          });

          if (!horse) {
            // Horse not in DB yet — create it with result data
            const trainer = runner.trainerName
              ? await upsertTrainer(runner.trainerName)
              : null;
            const jockey = runner.jockeyName
              ? await upsertJockey(runner.jockeyName)
              : null;
            const newHorse = await upsertHorse(runner, trainer?.id ?? null);

            await prisma.runner.upsert({
              where: {
                raceId_horseId: {
                  raceId: dbRace.id,
                  horseId: newHorse.id,
                },
              },
              create: {
                raceId: dbRace.id,
                horseId: newHorse.id,
                jockeyId: jockey?.id ?? null,
                trainerId: trainer?.id ?? null,
                drawPosition: runner.drawPosition,
                weightCarried: runner.weightCarried,
                officialRating: runner.officialRating,
                oddsSp: runner.oddsSp,
                oddsBest: runner.oddsBest,
                finishPosition: runner.finishPosition,
                beatenDistance: runner.beatenDistance,
              },
              update: {
                oddsSp: runner.oddsSp,
                finishPosition: runner.finishPosition,
                beatenDistance: runner.beatenDistance,
              },
            });
            runnersCount++;
            continue;
          }

          // Horse exists — update the runner row
          const dbRunner = await prisma.runner.findUnique({
            where: {
              raceId_horseId: {
                raceId: dbRace.id,
                horseId: horse.id,
              },
            },
          });

          if (dbRunner) {
            await prisma.runner.update({
              where: { id: dbRunner.id },
              data: {
                oddsSp: runner.oddsSp,
                finishPosition: runner.finishPosition,
                beatenDistance: runner.beatenDistance,
              },
            });
            runnersCount++;
          } else {
            // Runner row missing — create it
            const jockey = runner.jockeyName
              ? await upsertJockey(runner.jockeyName)
              : null;
            const trainer = runner.trainerName
              ? await upsertTrainer(runner.trainerName)
              : null;

            await prisma.runner.create({
              data: {
                raceId: dbRace.id,
                horseId: horse.id,
                jockeyId: jockey?.id ?? null,
                trainerId: trainer?.id ?? null,
                drawPosition: runner.drawPosition,
                weightCarried: runner.weightCarried,
                officialRating: runner.officialRating,
                oddsSp: runner.oddsSp,
                oddsBest: runner.oddsBest,
                finishPosition: runner.finishPosition,
                beatenDistance: runner.beatenDistance,
              },
            });
            runnersCount++;
          }
        } catch (err) {
          console.error(
            `Error syncing result for "${runner.horseName}" in ${race.raceName}:`,
            err
          );
          errors++;
        }
      }
    } catch (err) {
      console.error(`Error syncing results for "${race.raceName}":`, err);
      errors++;
    }
  }

  console.log(
    `[syncResults] date=${date} | races=${racesCount} runners=${runnersCount} errors=${errors}`
  );
  return { races: racesCount, runners: runnersCount, errors };
}

// ─── Sync: Odds (stub) ──────────────────────────────────────────────────────

/**
 * Fetch latest odds for today's runners.
 *
 * The Racing API free tier may not provide live odds. This is a stub
 * that re-fetches today's race cards and updates the `oddsBest` field
 * if odds are present.
 */
export async function syncOdds(): Promise<SyncResult> {
  // TODO: Implement once we confirm the Racing API free tier returns live odds.
  // The approach would be:
  //   1. Fetch today's race cards (they may include latest odds)
  //   2. For each runner, update the `oddsBest` field on the Runner row
  //   3. Optionally store a time-series of odds in a separate table
  console.log("[syncOdds] stub — not yet implemented");
  return { races: 0, runners: 0, errors: 0 };
}

// ─── Seed: Historical Data (placeholder) ────────────────────────────────────

/**
 * Placeholder for importing historical data from rpscrape CSV exports.
 *
 * rpscrape (https://github.com/4A47/rpscrape) generates CSV files with
 * columns like: date, course, time, race_name, type, class, distance,
 * going, horse, age, weight, jockey, trainer, or, sp, position, etc.
 *
 * The import pipeline would:
 *   1. Read the CSV row by row (e.g. with a streaming parser)
 *   2. Normalize each row into NormalizedRace / NormalizedRunner
 *   3. Upsert into the DB using the same helpers as syncRaceCards/syncResults
 */
export async function seedHistoricalData(): Promise<void> {
  // TODO: Implement CSV import from rpscrape data files.
  console.log("[seedHistoricalData] placeholder — not yet implemented");
}
