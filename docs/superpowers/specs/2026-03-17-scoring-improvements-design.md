# Scoring Improvements & Recommendation UX

**Date:** 2026-03-17
**Scope:** Improve accuracy from existing data (A) and recommendation clarity (C)

---

## Problem

The scoring engine has 11 factors but ignores several high-value fields already available from the Racing API (`rpr`, `last_run`, `headgear`, `lbs`). The class change factor is broken (`typicalClass` is hardcoded to `null`). On the UX side, users see a score number but no breakdown of *why* a horse is ranked, making it hard to trust the recommendation.

---

## Part 1: Accuracy Improvements

### 1.1 Fix Class Change Scoring

**Problem:** `typicalClass` is always `null` (engine.ts:232), so class scoring always falls back to the OR-vs-field-average heuristic. This misses explicit class drops/rises.

**Solution:** Compute `typicalClass` from the horse's last 3 race classes in the DB:

```
typicalClass = median of last 3 race.class values where horse was a runner (excluding current race)
```

**Changes:**
- `engine.ts` `scoreRace()` — in the `Promise.all` runner map, add a query for the horse's last 3 runners (excluding current race) with non-null `race.class`, take the median. This adds one DB query per runner per race (acceptable for SQLite).
- No schema change needed — race class is already stored on `Race.class`

### 1.2 New Factor: Days Since Last Run (Freshness)

**Problem:** `last_run` from Racing API (days since last race) is fetched but discarded. Race fitness is a strong predictor.

**Schema changes:**
- Add `lastRunDays Int?` to `Runner` model

**Sync changes:**
- `normalizeRunner()` — parse `r.last_run` into an integer, map to `lastRunDays`
- `syncRaceCards()` — store `lastRunDays` on the Runner record

**New factor file:** `src/lib/scoring/factors/freshness.ts`

Scoring curve:
| Days since last run | Score |
|---|---|
| 7-21 | 85 (peak fitness window) |
| 22-35 | 75 |
| 36-60 | 55 |
| 61-90 | 40 |
| 90+ | 30 (long absence) |
| 0-6 | 60 (quick turnaround, possible fatigue) |
| Unknown/null | 50 (neutral) |

### 1.3 New Factor: RPR (Racing Post Rating)

**Problem:** `rpr` is a professionally compiled rating that captures ability across the career. It's fetched from the API but discarded.

**Schema changes:**
- Add `rpr Int?` to `Runner` model (per-race RPR, not career — the API provides it per racecard entry)

**Sync changes:**
- `normalizeRunner()` — parse `r.rpr` as integer
- `syncRaceCards()` — store on Runner

**New factor file:** `src/lib/scoring/factors/rpr.ts`

Scoring: Compare runner's RPR to the field average RPR for this race.

| RPR vs field average | Score |
|---|---|
| +10 or more | 95 |
| +5 to +9 | 80 |
| +1 to +4 | 65 |
| 0 (equal) | 55 |
| -1 to -4 | 40 |
| -5 to -9 | 30 |
| -10 or worse | 20 |
| No RPR data | 50 |

### 1.4 New Factor: Weight Carried (Handicap Advantage)

**Problem:** `weightCarried` is stored as a string like `"154lbs"` but never scored. In handicaps, lighter weight is an advantage.

**Schema changes:** None — already stored on Runner as string. We parse the integer value at scoring time.

**New factor file:** `src/lib/scoring/factors/weight.ts`

Scoring: Compare runner's weight to the field average weight. The factor function receives `weightDiffLbs: number | null` and `isHandicap: boolean` (pre-computed by the engine).

| Weight vs field average | Score |
|---|---|
| 7+ lbs below average | 85 |
| 4-6 lbs below | 70 |
| 2-3 lbs below | 60 |
| Within 1 lb of average | 50 |
| 2-3 lbs above | 40 |
| 4-6 lbs above | 35 |
| 7+ lbs above | 25 |

For non-handicap races, return 50 (neutral). The engine determines `isHandicap` by checking if `race.raceName` contains "Handicap" or "Hcap" (case-insensitive), and passes it as a pre-computed boolean. This avoids the factor needing `raceName`.

### 1.5 New Factor: Headgear Change

**Problem:** First-time blinkers, cheekpieces, tongue tie etc. are among the strongest single-race signals. The API provides `headgear` as a string but it's discarded.

**Schema changes:**
- Add `headgear String?` to `Runner` model

**Sync changes:**
- `normalizeRunner()` — pass through `r.headgear`
- `syncRaceCards()` — store on Runner

**New factor file:** `src/lib/scoring/factors/headgear.ts`

Scoring logic (pure function, receives `isFirstTimeHeadgear: boolean` pre-computed by engine):
1. If this runner has headgear AND `isFirstTimeHeadgear` is true → **first-time headgear**: 75
2. If this runner has headgear AND `isFirstTimeHeadgear` is false → **wearing headgear again**: 55
3. If no headgear → 50 (neutral)

**First-time detection** is done in `scoreRace()` orchestrator (not the factor function, to keep factors synchronous/pure): query `Runner` table for same horse in prior races, check if any had the same headgear string. Pass the boolean result to the factor via `RunnerData.isFirstTimeHeadgear`.

### 1.6 Rebalanced Weights

New factors need weight budget. The approach: slightly reduce overweighted existing factors and allocate to new ones. Weights must sum to 1.0.

**Flat weights (new):**

| Factor | Old | New | Change |
|---|---|---|---|
| recentForm | 0.22 | 0.18 | -0.04 |
| goingPreference | 0.11 | 0.10 | -0.01 |
| distanceSuitability | 0.11 | 0.10 | -0.01 |
| trainerForm | 0.09 | 0.08 | -0.01 |
| jockeyForm | 0.09 | 0.07 | -0.02 |
| courseForm | 0.07 | 0.06 | -0.01 |
| classChange | 0.09 | 0.08 | -0.01 |
| drawPosition | 0.07 | 0.05 | -0.02 |
| trainerJockeyCombo | 0.05 | 0.04 | -0.01 |
| marketPosition | 0.05 | 0.04 | -0.01 |
| weatherImpact | 0.05 | 0.04 | -0.01 |
| **rpr** | — | **0.07** | new |
| **freshness** | — | **0.05** | new |
| **weightCarried** | — | **0.02** | new |
| **headgearChange** | — | **0.02** | new |
| **Total** | 1.00 | **1.00** | |

**Hurdles weights (new):**

| Factor | Old | New | Change |
|---|---|---|---|
| recentForm | 0.22 | 0.18 | -0.04 |
| goingPreference | 0.16 | 0.14 | -0.02 |
| distanceSuitability | 0.13 | 0.11 | -0.02 |
| trainerForm | 0.09 | 0.08 | -0.01 |
| jockeyForm | 0.07 | 0.06 | -0.01 |
| courseForm | 0.09 | 0.08 | -0.01 |
| classChange | 0.07 | 0.06 | -0.01 |
| drawPosition | 0.00 | 0.00 | — |
| trainerJockeyCombo | 0.05 | 0.04 | -0.01 |
| marketPosition | 0.07 | 0.05 | -0.02 |
| weatherImpact | 0.05 | 0.04 | -0.01 |
| **rpr** | — | **0.07** | new |
| **freshness** | — | **0.05** | new |
| **weightCarried** | — | **0.02** | new |
| **headgearChange** | — | **0.02** | new |
| **Total** | 1.00 | **1.00** | |

### 1.7 Interface Changes (engine.ts)

The existing interfaces in engine.ts must be extended to support the new factors. All factor functions remain pure/synchronous — async data fetching stays in the `scoreRace()` orchestrator.

**`RunnerData` additions:**
```typescript
lastRunDays: number | null;
rpr: number | null;
headgear: string | null;
isFirstTimeHeadgear: boolean;
weightCarriedLbs: number | null; // parsed from "154lbs" string
```

**`RaceData` additions:**
```typescript
raceName: string;          // needed for narrative context
averageFieldRpr: number | null;   // computed same pattern as averageFieldRating
averageFieldWeight: number | null; // average lbs across field
isHandicap: boolean;       // derived from raceName containing "Handicap"/"Hcap"
```

**`FactorBreakdown` additions:**
```typescript
rpr: number;
freshness: number;
weightCarried: number;
headgearChange: number;
```

**`scoreRunner()` total computation:** The weighted sum (engine.ts:108-119) must include the 4 new `factors.X * weights.X` terms.

Rationale:
- **RPR at 0.07** — expert rating is high-signal but shouldn't dominate; it validates other factors
- **Freshness at 0.05** — meaningful but secondary to form/going/distance
- **Weight and headgear at 0.02 each** — situational factors, small but non-zero
- **recentForm drops from 0.22 to 0.18** — still the most important factor, but RPR now covers some of what form was proxying (raw ability)

---

## Part 2: Recommendation UX

### 2.1 Persist Score Breakdown

**Problem:** Factor scores are computed in `scoreRunner()` but only the `totalScore` is saved to DB. The `best-bets.ts` module has to fake factors as all-50 when reconstructing from DB (best-bets.ts:83-94). This means the breakdown is lost after scoring.

**Schema changes:**
- Add `scoreBreakdown String?` to `Runner` model (JSON string, since SQLite has no native JSON type)

**Engine changes:**
- In `scoreRace()`, when persisting to DB, also save `JSON.stringify(factors)` to `scoreBreakdown`
- Add a `getBreakdown(runnerId)` helper that parses the JSON back into a `FactorBreakdown`

**API changes:**
- `GET /api/races/[raceId]` — already returns runners; `scoreBreakdown` will be included automatically via Prisma
- Frontend parses the JSON string client-side

### 2.2 Score Breakdown UI

**Problem:** Users see "Score: 78" with no insight into what's driving it.

**New component:** `src/components/score-breakdown.tsx` (file already exists — repurpose/rewrite it)

**Design:** A horizontal stacked bar or set of labelled mini-bars showing each factor's weighted contribution. Displayed in the expandable runner detail panel on the race detail page.

Layout (within the existing expand panel in `races/[raceId]/page.tsx`):

```
Score Breakdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Form          ████████████░░  85  (×0.18 = 15.3)
Going         ██████████░░░░  70  (×0.10 = 7.0)
RPR           █████████░░░░░  65  (×0.07 = 4.6)
Distance      ████████░░░░░░  60  (×0.10 = 6.0)
Class Change  ████████████░░  90  (×0.08 = 7.2)
...
```

Each bar:
- Label on the left
- Filled portion proportional to the 0-100 raw score
- Raw score number
- Weighted contribution in muted text
- Color: green (70+), default (40-69), red (<40)

Only show factors with weight > 0 for this race type (skip drawPosition for hurdles).

### 2.3 Narrative Summary

**Problem:** Users want a quick story — "why this horse?" — not just numbers.

**New module:** `src/lib/scoring/narrative.ts`

**Logic:** Template-based sentence builder. Takes a `FactorBreakdown`, the weights, and contextual data (horse name, going, course name) and produces 1-2 sentences highlighting the top contributing factors.

**Algorithm:**
1. Compute weighted contribution for each factor: `raw_score * weight`
2. Sort factors by weighted contribution descending
3. Take the top 3 factors (or top 2 if the 3rd is below a threshold)
4. Map each to a human-readable phrase using a template map
5. Join into a sentence

**Template map (factor → phrase based on raw score):**

| Factor | Score >= 70 | Score 40-69 | Score < 40 |
|---|---|---|---|
| recentForm | "strong recent form ({form})" | "fair recent form" | "poor recent form" |
| goingPreference | "handles {going} well" | "going is workable" | "ground may not suit" |
| distanceSuitability | "proven at this trip" | "adequate at this trip" | "distance a concern" |
| trainerForm | "trainer {name} in hot form ({rate}%)" | "trainer ticking over" | — |
| jockeyForm | "jockey {name} riding well" | — | — |
| courseForm | "course winner" / "good course record" | — | — |
| classChange | "dropping in class" | "similar class" | "rising in class" |
| rpr | "top-rated on RPR" | "RPR competitive" | "RPR below field average" |
| freshness | "fit from recent run" | — | "returning from a break" |
| weightCarried | "well handicapped" | — | "top weight" |
| headgearChange | "first-time headgear" | — | — |
| drawPosition | "favourable draw" | — | "drawn wide" |
| trainerJockeyCombo | "proven trainer/jockey combo" | — | — |

**Fallback rule:** If the top 3 factors by weighted contribution all have no applicable phrase (i.e. all "—" in their score band), skip them and continue to the next factor. If fewer than 2 phrases are generated, output a generic fallback: "Competitive profile across multiple factors."

**Output example:**
> "Dropping in class, strong recent form (1-2-1), handles soft ground well."

**Where it appears:**
- On the race detail page, above the score breakdown bars, as a bold summary line
- On the best-bets page, as the primary reason text (replacing the current `reasons[]` array)

### 2.4 Best Bets Integration

**Current problem:** `best-bets.ts` fakes all factor scores as 50 when reading from DB (lines 83-94), making the reasons list meaningless for pre-scored races.

**Fix:** Read `scoreBreakdown` from the Runner record and parse it, instead of defaulting to 50. This means:
- `reasons[]` array is now generated from real factor data
- The narrative summary replaces (or supplements) the current reasons list
- Best bets page shows the narrative as the primary "why" text

---

## Part 3: Value Bets & Vulnerable Favourites

### 3.1 Problem

The current best-bets system ranks by GambleKing score, which often just confirms the market favourite. Betting the favourite in every race is not a profitable strategy — the odds are too short to generate returns. The real value is in finding races where the favourite has exploitable weaknesses and a non-favourite has strong fundamentals.

### 3.2 Vulnerable Favourite Detection

**New module:** `src/lib/scoring/value-bets.ts`

A favourite is flagged as **vulnerable** when BOTH conditions are met:

1. **The favourite has at least one clear weakness** — any factor in their breakdown scores below 40 (e.g. going doesn't suit, rising in class, returning from long break)
2. **A non-favourite is competitive** — the GambleKing score gap between the favourite (marketRank=1) and the highest-scoring non-favourite is 8 points or less, OR a non-favourite actually outscores the favourite

The function `getValueBets(date)` returns a list of `ValueBet` objects:

```typescript
interface ValueBet {
  race: { /* same shape as BestBet.race */ };
  favourite: {
    horse: { name: string; id: string };
    gamblekingScore: number;
    weaknesses: string[];       // human-readable: "Struggles on soft ground", "Rising in class"
    scoreBreakdown: FactorBreakdown;
  };
  valuePick: {
    horse: { name: string; id: string };
    gamblekingScore: number;
    oddsBest: number | null;
    narrative: string;          // from narrative.ts
    scoreBreakdown: FactorBreakdown;
    jockey: { name: string } | null;
    trainer: { name: string } | null;
  };
  scoreGapToFav: number;        // negative means value pick outscores favourite
  vulnerabilityReason: string;  // one-line summary: "Favourite weak on going — X has better profile"
}
```

**Weakness detection** maps factor scores to readable strings:

| Factor | Score < 40 | Weakness text |
|---|---|---|
| recentForm | < 40 | "Poor recent form" |
| goingPreference | < 40 | "Struggles on {going}" |
| distanceSuitability | < 40 | "Unproven at this trip" |
| classChange | < 40 | "Rising in class" |
| freshness | < 40 | "Returning from long absence" |
| courseForm | < 40 | "No course form" |
| rpr | < 40 | "RPR below field average" |
| weightCarried | < 40 | "Carrying top weight" |
| drawPosition | < 40 | "Unfavourable draw" |

**Value pick selection:** Among non-favourites (marketRank > 1), take the runner with the highest GambleKing score. If that runner also has a clear strength (any factor >= 70) in an area where the favourite is weak (< 40), boost the vulnerability confidence.

**Sorting:** Value bets are sorted by vulnerability strength:
1. Non-favourite outscores favourite (strongest signal)
2. Score gap <= 4 points + favourite has 2+ weaknesses
3. Score gap <= 8 points + favourite has 1 weakness

### 3.3 Value Mode Toggle (Best Bets Page)

**UI change to `src/app/best-bets/page.tsx`:**

Add a toggle at the top of the best bets page:

```
[All Picks] [Value Bets]
```

- **All Picks** (default) — current behaviour, shows highest-scoring runners across all races
- **Value Bets** — shows only races where the favourite is vulnerable, recommending the non-favourite alternative

When Value Bets is active:
- The page calls `GET /api/best-bets?mode=value`
- Each card shows:
  - The race details (same as now)
  - The **value pick** (non-favourite) as the headline horse
  - A callout box: *"Favourite {name} vulnerable: {weakness reasons}. Consider {value pick name} at {odds}."*
  - The value pick's narrative summary
  - The value pick's score breakdown (if expanded)

### 3.4 API Changes

**`GET /api/best-bets`** — add optional `mode` query param:
- `mode=all` (default) — current behaviour via `getBestBets(date)`
- `mode=value` — calls new `getValueBets(date)` from `value-bets.ts`

### 3.5 Race Detail Page Integration

On the race detail page (`races/[raceId]/page.tsx`), when the favourite has vulnerabilities:
- Show a banner below the race header: **"Favourite may be beatable"** with the weakness reasons
- This uses the same detection logic but applied to a single race (can be a utility function reused from `value-bets.ts`)

---

## Files Changed

### Schema
- `prisma/schema.prisma` — add 3 fields to Runner (`lastRunDays`, `headgear`, `scoreBreakdown`), add 1 field to Runner (`rpr`)

### Sync Pipeline
- `src/lib/data-sources/types.ts` — add `lastRunDays`, `headgear`, `rpr` to `NormalizedRunner`
- `src/lib/data-sources/sync.ts` — store new fields from API response in both `syncRaceCards()` and `syncResults()` (both create Runner records)

### Scoring Engine
- `src/lib/scoring/config.ts` — update `ScoringWeights` interface with 4 new keys, add new weights to both configs
- `src/lib/scoring/engine.ts` — update `RunnerData`, `RaceData`, `FactorBreakdown` interfaces; add new factor imports; compute `typicalClass`, `averageFieldRpr`, `averageFieldWeight`, `isHandicap`, `isFirstTimeHeadgear`; extend `scoreRunner()` weighted sum; persist `scoreBreakdown` JSON
- New: `src/lib/scoring/factors/freshness.ts`
- New: `src/lib/scoring/factors/rpr.ts`
- New: `src/lib/scoring/factors/weight.ts`
- New: `src/lib/scoring/factors/headgear.ts`
- New: `src/lib/scoring/narrative.ts`

### API
- `src/app/api/races/[raceId]/route.ts` — no changes needed (Prisma will include new fields automatically)
- `src/app/api/best-bets/route.ts` — add `mode` query param support (`all` | `value`)

### Frontend
- `src/components/score-breakdown.tsx` — rewrite with factor bar chart and narrative
- `src/app/races/[raceId]/page.tsx` — integrate breakdown component into runner expand panel; add "Favourite may be beatable" banner
- `src/app/best-bets/page.tsx` — add All Picks / Value Bets toggle; show narrative summary; show value bet cards with vulnerability callout

### Best Bets & Value Bets
- `src/lib/scoring/best-bets.ts` — read `scoreBreakdown` from DB instead of faking factors
- New: `src/lib/scoring/value-bets.ts` — vulnerable favourite detection and value pick selection

---

## Migration

Single Prisma migration via `npx prisma migrate dev --name add-scoring-fields`, which generates:
```sql
ALTER TABLE Runner ADD COLUMN lastRunDays INTEGER;
ALTER TABLE Runner ADD COLUMN headgear TEXT;
ALTER TABLE Runner ADD COLUMN rpr INTEGER;
ALTER TABLE Runner ADD COLUMN scoreBreakdown TEXT;
```

All new columns are nullable, so no data backfill is required. After migration, a re-sync + re-score of today's races will populate all new fields. Pre-existing runners will have `scoreBreakdown = null` — the `best-bets.ts` parser should treat null as "no breakdown available" and fall back to re-scoring the race if needed.

---

## Out of Scope

- New external data sources (Sporting Life, speed figures) — future work
- Topspeed (`ts`) rating — API provides it but it's less reliable than RPR; can be added later
- Age/sex adjustments — meaningful but lower priority than the above
- Confidence level overhaul — current 3-tier system is adequate for now
- Full expected-value calculations (score vs odds) — would need live odds integration; current approach uses score-gap + weakness detection as a proxy for value
