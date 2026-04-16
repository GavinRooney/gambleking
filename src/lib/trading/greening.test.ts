import { describe, it, expect } from "vitest";
import {
  greenUpLayStake,
  greenUpBackStake,
  computeGreenUp,
  simulateOutcome,
  netOutcome,
} from "./greening";

// Helper: green up a position, then verify the quoted guaranteedProfit is the
// exact minimum of the two realised branches after the closing stake has been
// rounded to the penny. Betfair stake rounding means the two branches don't
// net to the same value; the quote must be the worse branch, not an
// idealised average.
function assertGreenedMatchesRealised(
  position: { side: "back" | "lay"; stake: number; odds: number },
  oppositePrice: number
): { netWin: number; netLose: number; guaranteed: number } {
  const quote = computeGreenUp(position, oppositePrice);
  const net = netOutcome([
    position,
    { side: quote.closingSide, stake: quote.closingStake, odds: quote.closingOdds },
  ]);
  const realisedMin = Math.min(net.ifWin, net.ifLose);
  // guaranteedProfit == realised min, exactly (no rounding drift).
  expect(quote.guaranteedProfit).toBe(realisedMin);
  // Strict floor: must never exceed either realised branch.
  expect(quote.guaranteedProfit).toBeLessThanOrEqual(net.ifWin);
  expect(quote.guaranteedProfit).toBeLessThanOrEqual(net.ifLose);
  return { netWin: net.ifWin, netLose: net.ifLose, guaranteed: quote.guaranteedProfit };
}

describe("greening — PRD §6.4 raw formula", () => {
  it("back-first: lay stake = (back stake × back odds) / current lay odds", () => {
    // Example from PRD text: back £100 @ 6.0, lay @ 5.8
    expect(greenUpLayStake(100, 6.0, 5.8)).toBeCloseTo(103.4483, 3);
  });

  it("lay-first: back stake = (lay stake × lay odds) / current back odds", () => {
    expect(greenUpBackStake(100, 3.0, 2.9)).toBeCloseTo(103.4483, 3);
  });

  it("rejects non-positive stakes and odds ≤ 1", () => {
    expect(() => greenUpLayStake(0, 3, 3)).toThrow();
    expect(() => greenUpLayStake(10, 1, 3)).toThrow();
    expect(() => greenUpLayStake(10, 3, 1)).toThrow();
  });
});

describe("greening — back-first scalps", () => {
  it("locks profit when odds shorten (favourable move)", () => {
    // Backed at 3.00, market shortened to 2.90 → scalper profits
    const { guaranteed: expectedProfit } = assertGreenedMatchesRealised(
      { side: "back", stake: 100, odds: 3.0 },
      2.9
    );
    expect(expectedProfit).toBeGreaterThan(0);
  });

  it("locks loss when odds drift (stop-loss or forced exit)", () => {
    // Backed at 3.00, market drifted to 3.10 → scalper loses
    const { guaranteed: expectedProfit } = assertGreenedMatchesRealised(
      { side: "back", stake: 100, odds: 3.0 },
      3.1
    );
    expect(expectedProfit).toBeLessThan(0);
  });

  it("breaks even on a scratch (same price)", () => {
    const { guaranteed: expectedProfit } = assertGreenedMatchesRealised(
      { side: "back", stake: 50, odds: 4.0 },
      4.0
    );
    expect(expectedProfit).toBeCloseTo(0, 5);
  });

  it("quote identifies lay as the closing side", () => {
    const quote = computeGreenUp({ side: "back", stake: 100, odds: 3.0 }, 2.9);
    expect(quote.closingSide).toBe("lay");
    expect(quote.closingOdds).toBe(2.9);
  });
});

describe("greening — lay-first scalps", () => {
  it("locks profit when odds drift (favourable for layer)", () => {
    // Layed at 2.00, market drifted to 2.10 → scalper profits
    const { guaranteed: expectedProfit } = assertGreenedMatchesRealised(
      { side: "lay", stake: 100, odds: 2.0 },
      2.1
    );
    expect(expectedProfit).toBeGreaterThan(0);
  });

  it("locks loss when odds shorten (unfavourable for layer)", () => {
    // Layed at 2.00, market shortened to 1.95 → scalper loses
    const { guaranteed: expectedProfit } = assertGreenedMatchesRealised(
      { side: "lay", stake: 100, odds: 2.0 },
      1.95
    );
    expect(expectedProfit).toBeLessThan(0);
  });

  it("quote identifies back as the closing side", () => {
    const quote = computeGreenUp({ side: "lay", stake: 100, odds: 2.0 }, 2.1);
    expect(quote.closingSide).toBe("back");
    expect(quote.closingOdds).toBe(2.1);
  });
});

describe("greening — closing stake rounding", () => {
  it("rounds closing stake to 2 decimal places", () => {
    const quote = computeGreenUp({ side: "back", stake: 100, odds: 6.0 }, 5.8);
    // Raw: 100 × 6 / 5.8 = 103.448275…
    expect(quote.closingStake).toBe(103.45);
  });

  it("guaranteedProfit is the exact worse-branch P&L, not an idealised mid", () => {
    // Back £100 @ 6.0 → lay £103.45 @ 5.8 (raw 103.4483 rounded UP to 103.45).
    // Win branch: 100 × 5 − 103.45 × 4.8 = 500 − 496.56 = 3.44
    // Lose branch: 103.45 − 100 = 3.45
    // Idealised formula would say 3.4483 → ~3.45, but true floor is 3.44.
    const quote = computeGreenUp({ side: "back", stake: 100, odds: 6.0 }, 5.8);
    expect(quote.guaranteedProfit).toBeCloseTo(3.44, 10);
  });
});

describe("greening — outcome simulation", () => {
  it("backing: win pays stake × (odds - 1), lose loses stake", () => {
    const r = simulateOutcome({ side: "back", stake: 10, odds: 4.0 });
    expect(r.ifWin).toBe(30);
    expect(r.ifLose).toBe(-10);
  });

  it("laying: win loses stake × (odds - 1), lose keeps stake", () => {
    const r = simulateOutcome({ side: "lay", stake: 10, odds: 4.0 });
    expect(r.ifWin).toBe(-30);
    expect(r.ifLose).toBe(10);
  });

  it("netOutcome sums a book of bets per outcome", () => {
    const net = netOutcome([
      { side: "back", stake: 10, odds: 3.0 },
      { side: "lay", stake: 10, odds: 3.0 },
    ]);
    expect(net.ifWin).toBe(0);
    expect(net.ifLose).toBe(0);
  });
});

describe("greening — precision sweep (penny-exact across the useful range)", () => {
  // Exhaustive check: for a wide grid of (stake, entry odds, close odds),
  // verify that guaranteedProfit never overstates the realised floor and
  // equals the realised floor after penny rounding. This is the regression
  // guard for the floating-point precision issue where the idealised
  // formula could claim £X and settlement realise £X − 0.01 on one branch.
  const stakes = [2, 5, 10, 25, 50, 100, 200];
  const entryOdds = [1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 10.0, 20.0];
  // Close odds sweep covers favourable move, scratch, and adverse move.
  const closeOffsets = [-0.5, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.5];

  it("back-first: quoted guaranteed profit equals worst realised branch to the penny", () => {
    let checked = 0;
    for (const stake of stakes) {
      for (const entry of entryOdds) {
        for (const offset of closeOffsets) {
          const close = +(entry + offset).toFixed(2);
          if (close <= 1) continue;
          const pos = { side: "back" as const, stake, odds: entry };
          const q = computeGreenUp(pos, close);
          const net = netOutcome([
            pos,
            { side: q.closingSide, stake: q.closingStake, odds: q.closingOdds },
          ]);
          const realisedMin = Math.min(net.ifWin, net.ifLose);
          // Strict: quoted == realised worst branch, bit-exact.
          expect({ stake, entry, close, quoted: q.guaranteedProfit, realisedMin })
            .toMatchObject({ quoted: realisedMin });
          // And quoted is a true floor, not a mid.
          expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifWin);
          expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifLose);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400); // sanity: sweep ran
  });

  it("lay-first: quoted guaranteed profit equals worst realised branch to the penny", () => {
    for (const stake of stakes) {
      for (const entry of entryOdds) {
        for (const offset of closeOffsets) {
          const close = +(entry + offset).toFixed(2);
          if (close <= 1) continue;
          const pos = { side: "lay" as const, stake, odds: entry };
          const q = computeGreenUp(pos, close);
          const net = netOutcome([
            pos,
            { side: q.closingSide, stake: q.closingStake, odds: q.closingOdds },
          ]);
          const realisedMin = Math.min(net.ifWin, net.ifLose);
          // Strict: quoted == realised worst branch, bit-exact.
          expect({ stake, entry, close, quoted: q.guaranteedProfit, realisedMin })
            .toMatchObject({ quoted: realisedMin });
          // And quoted is a true floor, not a mid.
          expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifWin);
          expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifLose);
        }
      }
    }
  });

  it("specifically covers the Y ∈ [2.15, 2.78] range where penny rounding flips the answer", () => {
    // These are the values where the old idealised formula would overstate
    // the floor by 1p. This test would have failed before the fix.
    const tricky = [2.15, 2.18, 2.22, 2.25, 2.3, 2.38, 2.54, 2.78];
    for (const close of tricky) {
      const pos = { side: "back" as const, stake: 50, odds: 3.0 };
      const q = computeGreenUp(pos, close);
      const net = netOutcome([
        pos,
        { side: q.closingSide, stake: q.closingStake, odds: q.closingOdds },
      ]);
      expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifWin);
      expect(q.guaranteedProfit).toBeLessThanOrEqual(net.ifLose);
    }
  });
});

describe("greening — worked example (PRD-style)", () => {
  it("back £100 @ 6.0 then market moves to 5.8", () => {
    // Per PRD §6.4: Green-up stake = 100 × 6.0 / 5.8 ≈ £103.45
    // Both realised branches settle close to £3.45 (lose) / £3.44 (win) —
    // the worse branch (win) is the penny-exact guaranteed floor.
    const quote = computeGreenUp({ side: "back", stake: 100, odds: 6.0 }, 5.8);
    expect(quote.closingStake).toBe(103.45);

    const net = netOutcome([
      { side: "back", stake: 100, odds: 6.0 },
      { side: "lay", stake: quote.closingStake, odds: 5.8 },
    ]);
    // Branches differ by ≤ 1p because of penny-level stake rounding.
    expect(Math.abs(net.ifWin - net.ifLose)).toBeLessThanOrEqual(0.02);
    // Quote matches the worse branch exactly.
    expect(quote.guaranteedProfit).toBe(Math.min(net.ifWin, net.ifLose));
  });
});
