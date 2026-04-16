import { describe, it, expect } from "vitest";
import {
  MIN_PRICE,
  MAX_PRICE,
  TICK_COUNT,
  isValidPrice,
  priceToTick,
  tickToPrice,
  addTicks,
  ticksBetween,
  nearestTick,
} from "./ticks";

describe("ticks — ladder shape", () => {
  it("has 350 total ticks spanning 1.01 → 1000", () => {
    expect(MIN_PRICE).toBe(1.01);
    expect(MAX_PRICE).toBe(1000);
    expect(TICK_COUNT).toBe(350);
  });

  it("starts at tick 0 = 1.01", () => {
    expect(tickToPrice(0)).toBe(1.01);
    expect(priceToTick(1.01)).toBe(0);
  });

  it("ends at tick 349 = 1000", () => {
    expect(tickToPrice(349)).toBe(1000);
    expect(priceToTick(1000)).toBe(349);
  });
});

describe("ticks — band boundaries", () => {
  // Boundary prices belong to the lower band; the next band starts one step above.
  const cases: Array<[number, number, number, string]> = [
    // [price, expected tick, next price after it, description]
    [2.0, 99, 2.02, "1.01-2.00 band ends at tick 99"],
    [3.0, 149, 3.05, "2.00-3.00 band ends at tick 149"],
    [4.0, 169, 4.1, "3.00-4.00 band ends at tick 169"],
    [6.0, 189, 6.2, "4.00-6.00 band ends at tick 189"],
    [10.0, 209, 10.5, "6.00-10.00 band ends at tick 209"],
    [20.0, 229, 21, "10.00-20.00 band ends at tick 229"],
    [30.0, 239, 32, "20.00-30.00 band ends at tick 239"],
    [50.0, 249, 55, "30.00-50.00 band ends at tick 249"],
    [100.0, 259, 110, "50.00-100.00 band ends at tick 259"],
  ];

  for (const [price, tick, nextPrice, desc] of cases) {
    it(desc, () => {
      expect(priceToTick(price)).toBe(tick);
      expect(tickToPrice(tick + 1)).toBe(nextPrice);
    });
  }
});

describe("ticks — addTicks within bands", () => {
  it("walks by 1 tick in the tightest band", () => {
    expect(addTicks(1.01, 1)).toBe(1.02);
    expect(addTicks(1.5, 1)).toBe(1.51);
  });

  it("walks by 1 tick in the 2-3 band", () => {
    expect(addTicks(2.5, 1)).toBe(2.52);
  });

  it("walks by 1 tick in the 3-4 band", () => {
    expect(addTicks(3.5, 1)).toBe(3.55);
  });

  it("walks by 1 tick in the 4-6 band", () => {
    expect(addTicks(5.0, 1)).toBe(5.1);
  });

  it("walks by 1 tick in the 6-10 band", () => {
    expect(addTicks(7.0, 1)).toBeCloseTo(7.2, 10);
  });

  it("walks by 1 tick in the 10-20 band", () => {
    expect(addTicks(15, 1)).toBe(15.5);
  });

  it("walks by 1 tick in the 100-1000 band", () => {
    expect(addTicks(500, 1)).toBe(510);
  });
});

describe("ticks — addTicks crossing band boundaries", () => {
  it("crosses 2.00 going up", () => {
    expect(addTicks(1.99, 1)).toBe(2.0);
    expect(addTicks(1.99, 2)).toBe(2.02);
    expect(addTicks(1.99, 3)).toBe(2.04);
  });

  it("crosses 2.00 going down", () => {
    expect(addTicks(2.02, -1)).toBe(2.0);
    expect(addTicks(2.02, -2)).toBe(1.99);
  });

  it("crosses 10.00 going up", () => {
    expect(addTicks(9.8, 1)).toBeCloseTo(10, 10);
    expect(addTicks(9.8, 2)).toBe(10.5);
  });

  it("walks from 1.99 to 2.02 is 2 ticks (1.99→2.00→2.02)", () => {
    expect(ticksBetween(1.99, 2.02)).toBe(2);
  });

  it("walks from 5.90 to 6.20 is 2 ticks (5.90→6.00→6.20)", () => {
    expect(ticksBetween(5.9, 6.2)).toBe(2);
  });

  it("reversed walks return negative ticks", () => {
    expect(ticksBetween(2.02, 1.99)).toBe(-2);
  });
});

describe("ticks — validation", () => {
  it("accepts every valid ladder price", () => {
    for (let i = 0; i < TICK_COUNT; i++) {
      const p = tickToPrice(i);
      expect(isValidPrice(p)).toBe(true);
      expect(priceToTick(p)).toBe(i);
    }
  });

  it("rejects between-tick prices", () => {
    expect(isValidPrice(1.005)).toBe(false); // below min granularity
    expect(isValidPrice(2.01)).toBe(false); // between 2.00 and 2.02
    expect(isValidPrice(3.01)).toBe(false); // between 3.00 and 3.05
    expect(isValidPrice(6.1)).toBe(false); // between 6.00 and 6.20
    expect(() => priceToTick(2.01)).toThrow(/not a valid/);
  });

  it("rejects out-of-range ticks", () => {
    expect(() => tickToPrice(-1)).toThrow(/out of range/);
    expect(() => tickToPrice(350)).toThrow(/out of range/);
    expect(() => tickToPrice(1.5)).toThrow(/out of range/);
  });
});

describe("ticks — nearestTick", () => {
  it("returns input when already valid", () => {
    expect(nearestTick(2.5)).toBe(2.5);
  });

  it("rounds to nearest when direction omitted", () => {
    // 2.01 is between 2.00 and 2.02 — equidistant, prefers lower (first-hit)
    expect(nearestTick(2.005)).toBe(2.0);
    expect(nearestTick(2.015)).toBe(2.02);
  });

  it("honours direction=down and direction=up", () => {
    expect(nearestTick(2.019, "down")).toBe(2.0);
    expect(nearestTick(2.019, "up")).toBe(2.02);
  });

  it("clamps to ladder bounds", () => {
    expect(nearestTick(0.5)).toBe(MIN_PRICE);
    expect(nearestTick(2000)).toBe(MAX_PRICE);
  });

  it("handles price exactly at MAX_PRICE with every direction", () => {
    expect(nearestTick(MAX_PRICE, "nearest")).toBe(MAX_PRICE);
    expect(nearestTick(MAX_PRICE, "up")).toBe(MAX_PRICE);
    expect(nearestTick(MAX_PRICE, "down")).toBe(MAX_PRICE);
  });

  it("handles price just below MAX_PRICE with direction=up (no OOB)", () => {
    // 999.99 is not on the ladder — direction=up would need prices[lowerIdx+1].
    // The max-clamp fallback must kick in without an undefined access.
    const near = MAX_PRICE - 0.01;
    expect(() => nearestTick(near, "up")).not.toThrow();
    expect(() => nearestTick(near, "down")).not.toThrow();
    expect(() => nearestTick(near, "nearest")).not.toThrow();
  });
});
