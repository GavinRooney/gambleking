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
  // Passthrough fields
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

export function parseDistance(distStr: string): number {
  let furlongs = 0;
  const mileMatch = distStr.match(/(\d+)m/);
  const furlongMatch = distStr.match(/(\d+)f/);

  if (mileMatch) furlongs += parseInt(mileMatch[1]) * 8;
  if (furlongMatch) furlongs += parseInt(furlongMatch[1]);
  if (furlongs === 0) furlongs = 8;

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
