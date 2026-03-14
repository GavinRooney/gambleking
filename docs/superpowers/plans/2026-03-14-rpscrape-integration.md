# rpscrape Historical Data Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the seed script to correctly import 5 years of rpscrape CSV data into GambleKing's database with proper column mapping, batch performance, and data quality fixes.

**Architecture:** The existing `scripts/seed-historical.ts` is rewritten in-place. Pure utility functions (parsing, normalization, column mapping) are extracted to `scripts/seed-utils.ts` for testability. A shell setup script automates rpscrape cloning and configuration. Vitest is added for testing the utility functions.

**Tech Stack:** TypeScript, Prisma (SQLite), Vitest, Bash

**Spec:** `docs/superpowers/specs/2026-03-14-rpscrape-integration-design.md`

---

## Chunk 1: Test Setup + Utility Functions

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to `"scripts"` in `package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
npm test
```

Expected: exits cleanly with "no test files found" or similar.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for testing seed utilities"
```

---

### Task 2: Extract and fix normalizeGoing

**Files:**
- Create: `scripts/seed-utils.ts`
- Create: `scripts/seed-utils.test.ts`

- [ ] **Step 1: Write failing tests for normalizeGoing**

Create `scripts/seed-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeGoing } from "./seed-utils";

describe("normalizeGoing", () => {
  it("returns 'heavy' for heavy going", () => {
    expect(normalizeGoing("Heavy")).toBe("heavy");
    expect(normalizeGoing("Heavy (Soft in places)")).toBe("heavy");
  });

  it("returns 'soft' for soft going (without good)", () => {
    expect(normalizeGoing("Soft")).toBe("soft");
    expect(normalizeGoing("soft")).toBe("soft");
  });

  it("returns 'good_to_soft' for good to soft", () => {
    expect(normalizeGoing("Good to Soft")).toBe("good_to_soft");
    expect(normalizeGoing("Good To Soft")).toBe("good_to_soft");
    expect(normalizeGoing("Good (Good to Soft in places)")).toBe("good_to_soft");
  });

  it("returns 'good_to_firm' for good to firm — NOT 'good'", () => {
    expect(normalizeGoing("Good to Firm")).toBe("good_to_firm");
    expect(normalizeGoing("Good To Firm")).toBe("good_to_firm");
    expect(normalizeGoing("Good (Good to Firm in places)")).toBe("good_to_firm");
  });

  it("returns 'firm' for firm going (without good)", () => {
    expect(normalizeGoing("Firm")).toBe("firm");
  });

  it("returns 'good' for standalone good", () => {
    expect(normalizeGoing("Good")).toBe("good");
    expect(normalizeGoing("good")).toBe("good");
  });

  it("defaults to 'good' for unknown going", () => {
    expect(normalizeGoing("Standard")).toBe("good");
    expect(normalizeGoing("")).toBe("good");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: FAIL — `normalizeGoing` not found (module doesn't exist yet).

- [ ] **Step 3: Implement normalizeGoing in seed-utils.ts**

Create `scripts/seed-utils.ts`:

```typescript
/**
 * Normalize going description to canonical category.
 * Must match the categories in src/lib/scoring/factors/going.ts GOING_ORDER:
 * firm | good_to_firm | good | good_to_soft | soft | heavy
 *
 * Order of checks matters: compound goings ("good to firm") must be checked
 * before their component parts ("firm", "good").
 */
export function normalizeGoing(going: string): string {
  const s = going.toLowerCase().replace(/[^a-z ]/g, " ").trim();

  if (s.includes("heavy")) return "heavy";
  if (s.includes("soft") && s.includes("good")) return "good_to_soft";
  if (s.includes("soft")) return "soft";
  if (s.includes("firm") && s.includes("good")) return "good_to_firm";
  if (s.includes("firm")) return "firm";
  return "good";
}
```

This mirrors the scoring engine's `normalizeGoing` in `src/lib/scoring/factors/going.ts:22-31`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-utils.ts scripts/seed-utils.test.ts
git commit -m "feat: extract normalizeGoing with good_to_firm fix"
```

---

### Task 3: Column mapping function

**Files:**
- Modify: `scripts/seed-utils.ts`
- Modify: `scripts/seed-utils.test.ts`

- [ ] **Step 1: Write failing tests for mapHeaders**

Add to `scripts/seed-utils.test.ts`:

```typescript
import { normalizeGoing, mapHeaders } from "./seed-utils";

describe("mapHeaders", () => {
  it("maps rpscrape column names to internal names", () => {
    const headers = ["date", "course", "pos", "dist", "lbs", "type", "pattern", "or", "btn", "ovr_btn", "draw"];
    const mapped = mapHeaders(headers);

    expect(mapped.get("position")).toBe(2);
    expect(mapped.get("distance")).toBe(3);
    expect(mapped.get("weight")).toBe(4);
    expect(mapped.get("race_type")).toBe(5);
    expect(mapped.get("race_name")).toBe(6);
    expect(mapped.get("official_rating")).toBe(7);
    expect(mapped.get("beaten_dist")).toBe(8);
    expect(mapped.get("ovr_beaten")).toBe(9);
    expect(mapped.get("draw")).toBe(10);
    // Passthrough
    expect(mapped.get("date")).toBe(0);
    expect(mapped.get("course")).toBe(1);
  });

  it("handles original column names (backwards compat)", () => {
    const headers = ["date", "course", "position", "distance", "weight", "race_type", "race_name"];
    const mapped = mapHeaders(headers);

    expect(mapped.get("position")).toBe(2);
    expect(mapped.get("distance")).toBe(3);
    expect(mapped.get("weight")).toBe(4);
    expect(mapped.get("race_type")).toBe(5);
    expect(mapped.get("race_name")).toBe(6);
  });

  it("is case-insensitive and normalizes whitespace", () => {
    const headers = ["Date", "COURSE", "Pos", "Dist"];
    const mapped = mapHeaders(headers);

    expect(mapped.get("date")).toBe(0);
    expect(mapped.get("course")).toBe(1);
    expect(mapped.get("position")).toBe(2);
    expect(mapped.get("distance")).toBe(3);
  });

  it("returns undefined index for missing columns", () => {
    const headers = ["date", "course"];
    const mapped = mapHeaders(headers);

    expect(mapped.get("draw")).toBeUndefined();
    expect(mapped.get("sire")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: FAIL — `mapHeaders` not exported.

- [ ] **Step 3: Implement mapHeaders**

Add to `scripts/seed-utils.ts`:

```typescript
/**
 * Maps CSV header names to internal field names, returning a Map<internalName, columnIndex>.
 * Handles both rpscrape's actual column names and the original expected names.
 */
const COLUMN_ALIASES: Record<string, string> = {
  // rpscrape actual → internal
  pos: "position",
  dist: "distance",
  lbs: "weight",
  type: "race_type",
  pattern: "race_name",
  or: "official_rating",
  btn: "beaten_dist",
  ovr_btn: "ovr_beaten",
  // Original names are also valid (identity mapping)
  position: "position",
  distance: "distance",
  weight: "weight",
  race_type: "race_type",
  race_name: "race_name",
  official_rating: "official_rating",
  beaten_dist: "beaten_dist",
  ovr_beaten: "ovr_beaten",
  draw: "draw",
  // Passthrough fields (no alias needed, just map to themselves)
  date: "date",
  course: "course",
  time: "time",
  going: "going",
  class: "class",
  horse: "horse",
  age: "age",
  sex: "sex",
  jockey: "jockey",
  trainer: "trainer",
  sp: "sp",
  sire: "sire",
  dam: "dam",
  rpr: "rpr",
};

export function mapHeaders(rawHeaders: string[]): Map<string, number> {
  const result = new Map<string, number>();

  rawHeaders.forEach((raw, index) => {
    const normalized = raw.toLowerCase().replace(/\s+/g, "_").trim();
    const internalName = COLUMN_ALIASES[normalized];
    if (internalName && !result.has(internalName)) {
      result.set(internalName, index);
    }
  });

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-utils.ts scripts/seed-utils.test.ts
git commit -m "feat: add column mapping for rpscrape CSV headers"
```

---

### Task 4: Extract remaining utility functions

**Files:**
- Modify: `scripts/seed-utils.ts`
- Modify: `scripts/seed-utils.test.ts`

- [ ] **Step 1: Write failing tests for parseDistance, parseSpOdds, getDistanceBand, getCountry, generateHorseId**

Add to `scripts/seed-utils.test.ts`:

```typescript
import {
  normalizeGoing,
  mapHeaders,
  parseDistance,
  parseSpOdds,
  getDistanceBand,
  getCountry,
  generateHorseId,
} from "./seed-utils";

describe("parseDistance", () => {
  it("parses furlongs", () => {
    expect(parseDistance("6f")).toBe(6);
    expect(parseDistance("5f")).toBe(5);
  });

  it("parses miles", () => {
    expect(parseDistance("1m")).toBe(8);
    expect(parseDistance("2m")).toBe(16);
  });

  it("parses miles and furlongs", () => {
    expect(parseDistance("1m2f")).toBe(10);
    expect(parseDistance("1m4f")).toBe(12);
  });

  it("defaults to 8f for unparseable input", () => {
    expect(parseDistance("")).toBe(8);
    expect(parseDistance("unknown")).toBe(8);
  });
});

describe("parseSpOdds", () => {
  it("parses fractional odds", () => {
    expect(parseSpOdds("5/1")).toBe(6.0);
    expect(parseSpOdds("11/4")).toBeCloseTo(3.75);
    expect(parseSpOdds("1/2")).toBe(1.5);
  });

  it("handles evens", () => {
    expect(parseSpOdds("evens")).toBe(2.0);
    expect(parseSpOdds("Evens")).toBe(2.0);
  });

  it("returns null for invalid input", () => {
    expect(parseSpOdds("")).toBeNull();
    expect(parseSpOdds("-")).toBeNull();
    expect(parseSpOdds("0")).toBeNull();
  });
});

describe("getDistanceBand", () => {
  it("categorizes distances into bands", () => {
    expect(getDistanceBand(5)).toBe("5f-6f");
    expect(getDistanceBand(6)).toBe("5f-6f");
    expect(getDistanceBand(7)).toBe("7f-8f");
    expect(getDistanceBand(8)).toBe("7f-8f");
    expect(getDistanceBand(10)).toBe("9f-11f");
    expect(getDistanceBand(12)).toBe("12f-14f");
    expect(getDistanceBand(16)).toBe("15f+");
  });
});

describe("getCountry", () => {
  it("identifies Irish courses", () => {
    expect(getCountry("Leopardstown")).toBe("IRE");
    expect(getCountry("Curragh")).toBe("IRE");
    expect(getCountry("Galway")).toBe("IRE");
  });

  it("defaults to UK for non-Irish courses", () => {
    expect(getCountry("Ascot")).toBe("UK");
    expect(getCountry("Newmarket")).toBe("UK");
    expect(getCountry("Cheltenham")).toBe("UK");
  });
});

describe("generateHorseId", () => {
  it("generates id from name only when no sire", () => {
    expect(generateHorseId("Frankel", "")).toBe("horse-frankel");
    expect(generateHorseId("Frankel", undefined)).toBe("horse-frankel");
  });

  it("includes sire for disambiguation", () => {
    expect(generateHorseId("Warrior Spirit", "Galileo")).toBe("horse-warrior-spirit-galileo");
  });

  it("normalizes whitespace and case", () => {
    expect(generateHorseId("SEA THE STARS", "Cape Cross")).toBe("horse-sea-the-stars-cape-cross");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: FAIL — functions not exported.

- [ ] **Step 3: Add implementations to seed-utils.ts**

Add to `scripts/seed-utils.ts`:

```typescript
export function parseDistance(distStr: string): number {
  let furlongs = 0;
  const mileMatch = distStr.match(/(\d+)m/);
  const furlongMatch = distStr.match(/(\d+)f/);

  if (mileMatch) furlongs += parseInt(mileMatch[1]) * 8;
  if (furlongMatch) furlongs += parseInt(furlongMatch[1]);
  if (furlongs === 0) furlongs = 8; // default 1 mile

  return furlongs;
}

export function parseSpOdds(sp: string): number | null {
  if (!sp || sp === "-" || sp === "0") return null;
  if (sp.toLowerCase() === "evens") return 2.0;

  const match = sp.match(/(\d+)\/(\d+)/);
  if (match) {
    return parseInt(match[1]) / parseInt(match[2]) + 1;
  }
  return null;
}

export function getDistanceBand(furlongs: number): string {
  if (furlongs <= 6) return "5f-6f";
  if (furlongs <= 8) return "7f-8f";
  if (furlongs <= 11) return "9f-11f";
  if (furlongs <= 14) return "12f-14f";
  return "15f+";
}

export function getCountry(course: string): string {
  const irishCourses = [
    "curragh", "leopardstown", "fairyhouse", "punchestown", "galway",
    "navan", "naas", "dundalk", "cork", "limerick", "tipperary",
    "gowran", "wexford", "killarney", "tramore", "clonmel",
    "ballinrobe", "bellewstown", "downpatrick", "down royal",
    "kilbeggan", "laytown", "listowel", "roscommon", "sligo",
    "thurles",
  ];
  return irishCourses.some((c) => course.toLowerCase().includes(c))
    ? "IRE"
    : "UK";
}

export function generateHorseId(name: string, sire: string | undefined | null): string {
  const normalizedName = name.toLowerCase().replace(/\s+/g, "-");
  if (sire && sire.trim()) {
    const normalizedSire = sire.toLowerCase().replace(/\s+/g, "-");
    return `horse-${normalizedName}-${normalizedSire}`;
  }
  return `horse-${normalizedName}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/seed-utils.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-utils.ts scripts/seed-utils.test.ts
git commit -m "feat: extract parseDistance, parseSpOdds, getDistanceBand, getCountry, generateHorseId"
```

---

## Chunk 2: Rewrite seed-historical.ts

### Task 5: Rewrite seed-historical.ts with column mapping, batch processing, and all fixes

This is the main rewrite. The file is replaced entirely — it reuses the utility functions from `scripts/seed-utils.ts` and restructures the import logic for batch performance.

**Files:**
- Modify: `scripts/seed-historical.ts` (full rewrite)

- [ ] **Step 1: Read the current seed-historical.ts to understand the full structure**

```bash
cat scripts/seed-historical.ts
```

Confirm: 407 lines, the version we've read during planning.

- [ ] **Step 2: Rewrite seed-historical.ts**

Replace the entire file. Key changes from the original:

1. **Import utilities from seed-utils.ts** instead of inline definitions
2. **Use mapHeaders()** to parse CSV headers flexibly
3. **Use field getter** `get(row, values, "position")` that looks up column index from mapped headers — returns `undefined` for missing columns
4. **Use generateHorseId()** with sire for disambiguation
5. **Use fixed normalizeGoing()** that correctly handles "good to firm"
6. **Import draw position** into Runner.drawPosition
7. **Import sire/dam** into Horse records
8. **Accumulate preferences in memory** using Maps keyed by composite keys
9. **No per-race-group transactions** — SQLite auto-commits are fine for upserts; the real perf win is the in-memory accumulation
10. **Bulk write preferences** after all runners in a file are processed
11. **Accumulate trainer/jockey win counts** in memory across ALL files, write absolute values once at the end of main() (idempotent)
12. **Progress logging** every 1000 runners
13. **Update help text** to show `-r gb` / `-r ire` commands

Full replacement for `scripts/seed-historical.ts`:

```typescript
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

async function processCSVFile(filePath: string): Promise<number> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length < 2) return 0;

  // Map headers using flexible column mapping
  const rawHeaders = parseCSVLine(lines[0]);
  const headerMap = mapHeaders(rawHeaders);

  // Verify minimum required columns
  if (!headerMap.has("date") || !headerMap.has("course") || !headerMap.has("horse")) {
    console.warn(`  Skipping ${path.basename(filePath)}: missing required columns (date, course, horse)`);
    return 0;
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
  const goingAccum = new Map<string, PrefAccum>();     // "horseId|going" → counts
  const distAccum = new Map<string, PrefAccum>();      // "horseId|band" → counts
  const courseAccum = new Map<string, PrefAccum>();     // "horseId|courseId" → counts
  const trainerWins = new Map<string, WinAccum>();     // trainerId → wins
  const jockeyWins = new Map<string, WinAccum>();      // jockeyId → wins

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

      {
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
```

- [ ] **Step 3: Verify the script compiles**

```bash
npx tsc --noEmit scripts/seed-historical.ts 2>&1 || npx tsx --eval "import './scripts/seed-historical'" 2>&1 | head -5
```

If there are import path issues, fix them. The script uses relative imports from `seed-utils.ts` and `../src/generated/prisma/client`.

- [ ] **Step 4: Run existing tests to ensure nothing broke**

```bash
npm test
```

Expected: all seed-utils tests still pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-historical.ts
git commit -m "feat: rewrite seed script with column mapping, batch processing, and data fixes"
```

---

## Chunk 3: Setup Script + Gitignore

### Task 6: Create setup-rpscrape.sh

**Files:**
- Create: `scripts/setup-rpscrape.sh`

- [ ] **Step 1: Create the shell script**

Create `scripts/setup-rpscrape.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── Check Python 3.13+ ─────────────────────────────────────────────────────

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is not installed."
  echo "rpscrape requires Python 3.13+. Install from https://www.python.org/downloads/"
  exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 13 ]; }; then
  echo "Error: Python $PY_VERSION found, but rpscrape requires Python 3.13+."
  echo "Install from https://www.python.org/downloads/"
  exit 1
fi

echo "Python $PY_VERSION found."

# ─── Clone rpscrape ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RPSCRAPE_DIR="$PROJECT_DIR/rpscrape"

if [ -d "$RPSCRAPE_DIR" ]; then
  echo "rpscrape already cloned at $RPSCRAPE_DIR"
else
  echo "Cloning rpscrape..."
  git clone https://github.com/joenano/rpscrape.git "$RPSCRAPE_DIR"
fi

# ─── Install Python dependencies ─────────────────────────────────────────────

echo "Installing Python dependencies..."
cd "$RPSCRAPE_DIR"
pip3 install -r requirements.txt

# ─── Configure rpscrape output columns ───────────────────────────────────────

SETTINGS_DIR="$RPSCRAPE_DIR/settings"
mkdir -p "$SETTINGS_DIR"

# Copy default settings as base if user_settings doesn't exist yet
if [ ! -f "$SETTINGS_DIR/user_settings.toml" ]; then
  if [ -f "$SETTINGS_DIR/default_settings.toml" ]; then
    cp "$SETTINGS_DIR/default_settings.toml" "$SETTINGS_DIR/user_settings.toml"
    echo "Created user_settings.toml from default_settings.toml"
  else
    echo "Warning: No default_settings.toml found. You may need to configure rpscrape manually."
    echo "Ensure output includes: date, course, time, dist, going, type, pos, horse, age, sex, lbs, jockey, trainer, or, sp, draw, sire, dam, btn, ovr_btn"
  fi
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "Setup complete! Now run the scraper:"
echo ""
echo "  cd $RPSCRAPE_DIR"
echo "  python3 scripts/rpscrape.py -r gb -y 2020-2025"
echo "  python3 scripts/rpscrape.py -r ire -y 2020-2025"
echo ""
echo "Then import the data:"
echo ""
echo "  cd $PROJECT_DIR"
echo "  npm run db:seed -- ./rpscrape/data"
echo ""
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/setup-rpscrape.sh
```

- [ ] **Step 3: Verify it runs (dry run — will fail at clone if no network, that's OK)**

```bash
bash -n scripts/setup-rpscrape.sh
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-rpscrape.sh
git commit -m "feat: add setup-rpscrape.sh for automated rpscrape setup"
```

---

### Task 7: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add rpscrape/ to .gitignore**

Append to `.gitignore`:

```
# rpscrape (cloned tool + scraped CSV data)
rpscrape/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore rpscrape directory"
```

---

## Chunk 4: Smoke Test

### Task 8: Create a small test CSV and verify the seed script works end-to-end

**Files:**
- Create: `scripts/test-fixtures/sample.csv` (temporary, for manual testing)

- [ ] **Step 1: Create a small test CSV with rpscrape-style headers**

Create `scripts/test-fixtures/sample.csv`:

```csv
date,course,time,pattern,class,dist,going,type,pos,horse,age,sex,lbs,jockey,trainer,or,sp,draw,sire,dam,btn,ovr_btn
2024-06-15,Ascot,14:30,Royal Ascot Stakes,2,1m2f,Good to Firm,Flat,1,Frankel Jr,4,C,126,R Moore,J Gosden,112,5/1,3,Frankel,Kind,0,0
2024-06-15,Ascot,14:30,Royal Ascot Stakes,2,1m2f,Good to Firm,Flat,2,Sea Star,5,G,124,L Dettori,A Fabre,108,3/1,7,Sea The Stars,Moonshine,1.5,1.5
2024-06-15,Ascot,14:30,Royal Ascot Stakes,2,1m2f,Good to Firm,Flat,3,Thunder Bolt,3,C,118,W Buick,C Appleby,105,11/4,1,Dubawi,Lightning,3,4.5
2024-06-15,Ascot,15:05,King George,1,1m4f,Good to Firm,Flat,1,Sea Star,5,G,126,L Dettori,A Fabre,115,2/1,4,Sea The Stars,Moonshine,0,0
2024-06-15,Ascot,15:05,King George,1,1m4f,Good to Firm,Flat,2,Frankel Jr,4,C,126,R Moore,J Gosden,112,7/2,2,Frankel,Kind,2,2
2024-06-15,Leopardstown,14:00,Leopardstown Stakes,3,7f,Soft,Flat,1,Dublin Flyer,3,F,119,C Keane,A O'Brien,98,4/1,5,Galileo,Swift,0,0
```

- [ ] **Step 2: Ensure the database is migrated**

```bash
npx prisma migrate dev
```

- [ ] **Step 3: Run the seed script on the test fixture**

```bash
npx tsx scripts/seed-historical.ts scripts/test-fixtures
```

Expected output:
- "Found 1 CSV files to process"
- Processes 6 runners across 3 races
- Reports counts for Horses, Races, Courses, Trainers, Jockeys

- [ ] **Step 4: Verify data in the database**

```bash
npx prisma studio
```

Check:
- **Courses:** Ascot (UK) and Leopardstown (IRE) exist
- **Races:** 3 races with correct going, distance, type
- **Horses:** 4 horses, with sire/dam populated. "Sea Star" has ID `horse-sea-star-sea-the-stars`
- **Runners:** 6 runners. Frankel Jr at Ascot 14:30 has `drawPosition: 3`, `officialRating: 112`
- **GoingPreference:** "good_to_firm" entries (NOT "good") for Ascot runners. "soft" for Dublin Flyer.
- **DistancePreference:** "9f-11f" for 1m2f runners, "12f-14f" for 1m4f runners, "7f-8f" for 7f runners
- **CourseForm:** Correct per-horse per-course aggregates
- **Trainers:** J Gosden and A Fabre each have flatWins > 0

- [ ] **Step 5: Clean up test fixture and commit**

```bash
rm -rf scripts/test-fixtures
git add scripts/seed-historical.ts scripts/seed-utils.ts
git commit -m "test: verify seed script with sample rpscrape data"
```

This final commit captures any small fixes made during the smoke test.
