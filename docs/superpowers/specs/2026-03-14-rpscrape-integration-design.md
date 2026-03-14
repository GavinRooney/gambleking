# rpscrape Historical Data Integration

**Date:** 2026-03-14
**Scope:** Import 5 years (2020-2025) of UK/Ireland horse racing results from rpscrape into GambleKing's SQLite database, populating the scoring engine's historical data tables.

## Overview

GambleKing's scoring engine uses 11 factors, many of which depend on historical data (going preferences, distance preferences, course form, trainer/jockey strike rates, recent form). The app currently has no historical data. rpscrape (github.com/joenano/rpscrape) provides free bulk CSV exports of Racing Post results. A seed script (`scripts/seed-historical.ts`) already exists but has column-name mismatches with rpscrape's current output and performance issues that make large imports impractical.

This design fixes compatibility, adds batch performance, automates setup, and fixes several data quality bugs in the existing seed script.

## Components

### 1. Setup Script (`scripts/setup-rpscrape.sh`)

A shell script that automates rpscrape setup:

- Checks Python 3.13+ is installed (exits with clear error if not)
- Clones rpscrape repo into `./rpscrape/` (skips if already present)
- Installs Python dependencies via `pip install -r requirements.txt`
- Copies a pre-configured `user_settings.toml` into `rpscrape/settings/` that enables the columns GambleKing needs:
  - date, course, time, race_name/pattern, class, dist, going, type, pos, horse, age, sex, lbs, jockey, trainer, or, rpr, sp, draw, sire, dam, btn, ovr_btn
- Prints instructions for running the scrape:
  ```
  cd rpscrape
  python scripts/rpscrape.py -r gb -y 2020-2025
  python scripts/rpscrape.py -r ire -y 2020-2025
  ```
- Update seed script help text to match these commands (currently shows `-c all` which is a different mode)

### 2. Column Mapping Layer (in `seed-historical.ts`)

A flexible header mapping that translates rpscrape's actual column names to internal field names:

| rpscrape header | Internal field   | Notes |
|-----------------|------------------|-------|
| `pos`           | `position`       | |
| `dist`          | `distance`       | |
| `lbs`           | `weight`         | |
| `type`          | `race_type`      | |
| `pattern`       | `race_name`      | |
| `or`            | `official_rating` | Official Rating — takes precedence over `rpr` if both present |
| `rpr`           | `rpr`            | Racing Post Rating — stored separately, not used as official_rating |
| `btn`           | `beaten_dist`    | |
| `ovr_btn`       | `ovr_beaten`     | |
| `draw`          | `draw`           | Maps to Runner.drawPosition — currently not imported, needed for draw scoring factor |

Properties:
- Case-insensitive, whitespace-normalized matching
- Backwards compatible with the original expected column names (e.g. `position`, `distance`, `weight` still work)
- Missing columns result in null values rather than crashes
- `or` and `rpr` are distinct: `or` maps to `Runner.officialRating`, `rpr` is ignored for now (future use)

### 3. Batch Processing & Transactions

This is a substantial rewrite of the preference update logic in `seed-historical.ts`. The current script performs a read-modify-write cycle (findUnique + upsert) for GoingPreference, DistancePreference, and CourseForm on every single runner — 6 DB calls per runner. This must be replaced entirely.

New approach for handling 200k+ runners:

- **Transaction batching:** Each CSV file's import is wrapped in a Prisma `$transaction`
- **In-memory accumulation:** Build `Map<string, {runs, wins, places}>` keyed by `horseId-going`, `horseId-distanceBand`, `horseId-courseId`. Increment counters in memory as runners are processed. Write all accumulated preferences to DB in bulk after all runners in the file are processed.
- **Bulk race processing:** Runners grouped by race are processed together in a single transaction
- **Progress logging:** Log every 1000 runners with count, percentage, and elapsed time

Expected improvement: hours to minutes for 5 years of data.

### 4. Bug Fixes

#### Going normalization: "good to firm" misclassified as "good"

The existing `normalizeGoing()` function returns `"good"` for "good to firm" going. The scoring engine's going factor (`src/lib/scoring/factors/going.ts`) treats `"good_to_firm"` as a distinct category in its `GOING_ORDER`. This mismatch means horses that perform well on good-to-firm ground (extremely common in UK flat racing) will have their preferences incorrectly bucketed under "good", silently corrupting the going scoring factor.

**Fix:** Change `normalizeGoing()` to return `"good_to_firm"` for "good to firm" going. The full going normalization should be:
- "heavy" → `"heavy"`
- "soft" (without "good") → `"soft"`
- "good to soft" → `"good_to_soft"`
- "good to firm" → `"good_to_firm"`
- "firm" (without "good") → `"firm"`
- "good" (standalone) → `"good"`

**Important:** Check order of conditions — "good to firm" must be checked before standalone "firm" and "good".

#### Horse ID collisions for same-named horses

The current horse ID generation (`horse-${name.toLowerCase().replace(/\s+/g, "-")}`) produces identical IDs for different horses with the same name. Horse names are not unique in racing — different horses across UK/Ireland or different eras can share names.

**Fix:** Include sire in the horse ID for disambiguation: `horse-${name}-${sire}` (normalized). If sire is not available, fall back to name-only (existing behavior). This is not perfect (no single field guarantees uniqueness) but eliminates the vast majority of collisions since name+sire is effectively unique in practice.

### 5. Supporting Changes

- **`.gitignore`:** Add `rpscrape/` to prevent committing cloned repo and scraped CSVs
- **Trainer/Jockey win counts:** During import, accumulate `flatWins` and `hurdleWins` for each trainer/jockey. These are simple lifetime counters that can be incremented as runners are processed. Write final totals after all files are imported.
- **Trainer/Jockey strike rates:** The 14/30-day rolling window rates (`strikeRate14d`, `strikeRate30d`) cannot be meaningfully computed from a bulk historical import — they represent recent form at a point in time, not a lifetime aggregate. These fields will remain null after seeding and will be populated by the daily results sync cron job going forward. The scoring engine already handles null strike rates gracefully (returns neutral 40/100 score).
- **Sire/Dam capture:** rpscrape provides sire and dam data. Store on Horse records (schema already has these fields). Sire is also used for horse ID disambiguation (see bug fix above).
- **Draw position:** Import `draw` column from rpscrape into `Runner.drawPosition`. Currently not imported, causing the draw scoring factor (weight 0.07 for flat) to always return the neutral default.

## Data Flow

```
./scripts/setup-rpscrape.sh
    |
    v
Clone + configure rpscrape
    |
    v
User runs: python scripts/rpscrape.py -r gb -y 2020-2025
           python scripts/rpscrape.py -r ire -y 2020-2025
    |
    v
CSV files in rpscrape/data/
    |
    v
npm run db:seed ./rpscrape/data
    |
    v
seed-historical.ts:
  1. Read CSV files from directory
  2. Map headers via column mapping layer
  3. Group rows by race (date + course + time)
  4. For each CSV file (in transaction):
     a. Upsert courses
     b. Upsert races
     c. Upsert horses (with sire/dam, using name+sire for ID)
     d. Upsert trainers/jockeys (accumulate win counts in memory)
     e. Upsert runners (with finish position, odds, weight, draw)
     f. Accumulate going/distance/course preferences in memory
  5. Bulk write accumulated preferences (GoingPreference, DistancePreference, CourseForm)
  6. Bulk write trainer/jockey flatWins/hurdleWins
    |
    v
Database populated: Course, Race, Horse, Runner, Trainer, Jockey,
                    GoingPreference, DistancePreference, CourseForm
    |
    v
Scoring engine has historical context for 10 of 11 factors
(strike rates populated by daily cron going forward)
```

## Files Modified

| File | Change |
|------|--------|
| `scripts/seed-historical.ts` | Rewrite: column mapping, batch processing, bug fixes (going normalization, horse ID disambiguation), draw import, sire/dam capture, trainer/jockey win counts |
| `scripts/setup-rpscrape.sh` | New file - setup automation |
| `.gitignore` | Add `rpscrape/` |

## Out of Scope

- Automatic re-scraping or scheduled updates (manual process for now)
- ML model training from historical data (future work)
- Racing Post web scraping (using rpscrape tool instead)
- Live odds integration
- RPR (Racing Post Rating) storage — only OR (Official Rating) is used currently
- Trainer/jockey 14/30-day strike rates from historical data (populated by daily cron instead)
