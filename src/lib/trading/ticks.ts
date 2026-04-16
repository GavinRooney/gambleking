// Betfair price ladder and tick arithmetic.
//
// Betfair uses variable tick increments depending on the odds band (PRD §2.2):
//
//   1.01 →   2.00   step 0.01
//   2.00 →   3.00   step 0.02
//   3.00 →   4.00   step 0.05
//   4.00 →   6.00   step 0.10
//   6.00 →  10.00   step 0.20
//  10.00 →  20.00   step 0.50
//  20.00 →  30.00   step 1.00
//  30.00 →  50.00   step 2.00
//  50.00 → 100.00   step 5.00
// 100.00 → 1000.00  step 10.00
//
// Band boundary prices (2.0, 3.0, 4.0, 6.0, 10.0, 20.0, 30.0, 50.0, 100.0) are
// each a single tick — they belong to the lower band and the next band starts
// one step above them.

type Band = { start: number; end: number; step: number };

const BANDS: readonly Band[] = [
  { start: 1.01, end: 2.0, step: 0.01 },
  { start: 2.0, end: 3.0, step: 0.02 },
  { start: 3.0, end: 4.0, step: 0.05 },
  { start: 4.0, end: 6.0, step: 0.1 },
  { start: 6.0, end: 10.0, step: 0.2 },
  { start: 10.0, end: 20.0, step: 0.5 },
  { start: 20.0, end: 30.0, step: 1.0 },
  { start: 30.0, end: 50.0, step: 2.0 },
  { start: 50.0, end: 100.0, step: 5.0 },
  { start: 100.0, end: 1000.0, step: 10.0 },
];

// Work in integer pence (× 100) to avoid floating-point accumulation errors
// when walking the ladder.
function toPence(price: number): number {
  return Math.round(price * 100);
}

function fromPence(pence: number): number {
  return Math.round(pence) / 100;
}

function buildLadder(): { prices: readonly number[]; indexByPence: ReadonlyMap<number, number> } {
  const prices: number[] = [];
  const indexByPence = new Map<number, number>();

  for (let b = 0; b < BANDS.length; b++) {
    const band = BANDS[b];
    const startPence = toPence(band.start);
    const endPence = toPence(band.end);
    const stepPence = toPence(band.step);

    // First band includes its start price; subsequent bands start one step above
    // their `start` (which coincides with the previous band's end).
    const firstPence = b === 0 ? startPence : startPence + stepPence;

    for (let p = firstPence; p <= endPence; p += stepPence) {
      const idx = prices.length;
      prices.push(fromPence(p));
      indexByPence.set(p, idx);
    }
  }

  return { prices, indexByPence };
}

const LADDER = buildLadder();

export const MIN_PRICE = LADDER.prices[0];
export const MAX_PRICE = LADDER.prices[LADDER.prices.length - 1];
export const TICK_COUNT = LADDER.prices.length;

export function isValidPrice(price: number): boolean {
  return LADDER.indexByPence.has(toPence(price));
}

export function priceToTick(price: number): number {
  const idx = LADDER.indexByPence.get(toPence(price));
  if (idx === undefined) {
    throw new Error(`Price ${price} is not a valid Betfair tick`);
  }
  return idx;
}

export function tickToPrice(tick: number): number {
  if (!Number.isInteger(tick) || tick < 0 || tick >= LADDER.prices.length) {
    throw new Error(`Tick index ${tick} is out of range [0, ${LADDER.prices.length - 1}]`);
  }
  return LADDER.prices[tick];
}

export function addTicks(price: number, n: number): number {
  return tickToPrice(priceToTick(price) + n);
}

export function ticksBetween(from: number, to: number): number {
  return priceToTick(to) - priceToTick(from);
}

// Snap an arbitrary price (e.g. a raw number from an external feed) to a
// valid tick. `direction` of `up` or `down` forces rounding; `nearest` picks
// the closer of the two (ties round down).
//
// Works in float space so sub-tick inputs like 2.019 don't get collapsed onto
// 2.02 by integer-pence rounding before we can decide.
export function nearestTick(
  price: number,
  direction: "up" | "down" | "nearest" = "nearest"
): number {
  const EPS = 1e-9;
  if (price <= MIN_PRICE + EPS) return MIN_PRICE;
  if (price >= MAX_PRICE - EPS) return MAX_PRICE;

  // Linear scan — ladder has 350 entries and this is called rarely.
  let lowerIdx = 0;
  for (let i = 0; i < LADDER.prices.length; i++) {
    if (LADDER.prices[i] <= price + EPS) lowerIdx = i;
    else break;
  }
  const lower = LADDER.prices[lowerIdx];
  if (Math.abs(price - lower) < EPS) return lower; // exact hit

  // Defensive: if the scan landed on the last rung (shouldn't happen because
  // of the MAX_PRICE guard above, but cheap insurance against future edits to
  // EPS or the guards), clamp to the ladder.
  if (lowerIdx >= LADDER.prices.length - 1) return lower;

  const upper = LADDER.prices[lowerIdx + 1];
  if (direction === "down") return lower;
  if (direction === "up") return upper;
  return price - lower <= upper - price ? lower : upper;
}
