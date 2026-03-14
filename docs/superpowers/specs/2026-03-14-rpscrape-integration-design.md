# rpscrape Historical Data Integration

**Date:** 2026-03-14
**Scope:** Import 5 years (2020-2025) of UK/Ireland horse racing results from rpscrape into GambleKing's SQLite database, populating the scoring engine's historical data tables.

## Overview

GambleKing's scoring engine uses 11 factors, many of which depend on historical data (going preferences, distance preferences, course form, trainer/jockey strike rates, recent form). The app currently has no historical data. rpscrape (github.com/joenano/rpscrape) provides free bulk CSV exports of Racing Post results. A seed script (`scripts/seed-historical.ts`) already exists but has column-name mismatches with rpscrape's current output and performance issues that make large imports impractical.

This design fixes compatibility, adds batch performance, and automates setup.

## Components

### 1. Setup Script (`scripts/setup-rpscrape.sh`)

A shell script that automates rpscrape setup:

- Checks Python 3.13+ is installed (exits with clear error if not)
- Clones rpscrape repo into `./rpscrape/` (skips if already present)
- Installs Python dependencies via `pip install -r requirements.txt`
- Copies a pre-configured `user_settings.toml` into `rpscrape/settings/` that enables the columns GambleKing needs:
  - date, course, time, race_name/pattern, class, dist, going, type, pos, horse, age, sex, lbs, jockey, trainer, or/rpr, sp, draw, sire, dam, btn, ovr_btn
- Prints instructions for running the scrape:
  ```
  cd rpscrape
  python scripts/rpscrape.py -r gb -y 2020-2025
  python scripts/rpscrape.py -r ire -y 2020-2025
  ```

### 2. Column Mapping Layer (in `seed-historical.ts`)

A flexible header mapping that translates rpscrape's actual column names to internal field names:

| rpscrape header | Internal field |
|-----------------|---------------|
| `pos`           | `position`    |
| `dist`          | `distance`    |
| `lbs`           | `weight`      |
| `type`          | `race_type`   |
| `pattern`       | `race_name`   |
| `or` / `rpr`    | `or`          |
| `btn`           | `beaten_dist` |
| `ovr_btn`       | `ovr_beaten`  |

Properties:
- Case-insensitive, whitespace-normalized matching
- Backwards compatible with the original expected column names (e.g. `position`, `distance`, `weight` still work)
- Missing columns result in null values rather than crashes

### 3. Batch Processing & Transactions

Performance redesign for handling 200k+ runners:

- **Transaction batching:** Each CSV file's import is wrapped in a Prisma `$transaction`
- **In-memory accumulation:** Going/distance/course preference updates are accumulated per horse across the entire file, then written once at the end (replaces current read-modify-write per runner)
- **Bulk race processing:** Runners grouped by race are processed together in a single transaction
- **Progress logging:** Log every 1000 runners with count, percentage, and elapsed time

Expected improvement: hours to minutes for 5 years of data.

### 4. Supporting Changes

- **`.gitignore`:** Add `rpscrape/` to prevent committing cloned repo and scraped CSVs
- **Trainer/Jockey enrichment:** During import, compute and store `flatWins`, `hurdleWins`, and 14/30-day strike rates on Trainer/Jockey records. The scoring engine's trainer and jockey factors already read these fields but they are never populated from historical data currently.
- **Sire/Dam capture:** rpscrape provides sire and dam data. Store on Horse records (schema already has these fields). Useful for future breeding-form scoring factor.

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
     c. Upsert horses (with sire/dam)
     d. Upsert trainers/jockeys (accumulate win counts)
     e. Upsert runners (with finish position, odds, weight, draw)
     f. Accumulate going/distance/course preferences in memory
  5. Bulk write accumulated preferences
  6. Update trainer/jockey strike rates
    |
    v
Database populated: Course, Race, Horse, Runner, Trainer, Jockey,
                    GoingPreference, DistancePreference, CourseForm
    |
    v
Scoring engine has full historical context for all 11 factors
```

## Files Modified

| File | Change |
|------|--------|
| `scripts/seed-historical.ts` | Column mapping, batch processing, trainer/jockey enrichment, sire/dam capture |
| `scripts/setup-rpscrape.sh` | New file - setup automation |
| `.gitignore` | Add `rpscrape/` |

## Out of Scope

- Automatic re-scraping or scheduled updates (manual process for now)
- ML model training from historical data (future work)
- Racing Post web scraping (using rpscrape tool instead)
- Live odds integration
