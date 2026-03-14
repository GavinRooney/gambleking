import { describe, it, expect } from "vitest";
import {
  normalizeGoing,
  mapHeaders,
  parseDistance,
  parseSpOdds,
  getDistanceBand,
  getCountry,
  generateHorseId,
} from "./seed-utils";

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
