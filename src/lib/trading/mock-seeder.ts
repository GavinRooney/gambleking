// Seeds a handful of synthetic markets into the MockBetAngelClient so the
// dashboard has something to display immediately when mock mode starts a
// session. Idempotent — only seeds if the mock's market list is empty.

import type { MockBetAngelClient } from "./bet-angel/mock-client";

const COURSES: Array<{ name: string; country: "GB" | "IE" }> = [
  { name: "Ascot", country: "GB" },
  { name: "Leopardstown", country: "IE" },
  { name: "Goodwood", country: "GB" },
  { name: "Newmarket", country: "GB" },
];

const HORSE_NAMES = [
  "Lucky Hoare",
  "Midnight Runner",
  "Silver Streak",
  "Thunder Strike",
  "Royal Ascent",
  "Gilded Age",
  "Ember Dream",
  "Velvet Rose",
  "Storm Chaser",
  "Northern Light",
];

// Seed 4 markets, each with 8 runners, starting 20-50 minutes out. Scenarios
// vary so the dashboard shows a mix of trading activity and ignored markets.
export function seedMockMarkets(client: MockBetAngelClient, now: Date = new Date()): void {
  // If the mock already has any markets we assume the user set them up
  // manually (or a previous session seeded) and leave them alone.
  // Quick check via public interface:
  if (client.getMarket("mock-1.ascot")) return;

  const scenarios: Array<"stable" | "drifting" | "steaming" | "thin-book"> = [
    "stable",
    "stable",
    "drifting",
    "thin-book",
  ];

  COURSES.forEach((course, i) => {
    const marketId = `mock-1.${course.name.toLowerCase()}`;
    const startTime = new Date(now.getTime() + (20 + i * 10) * 60_000);
    const runners = HORSE_NAMES.slice(0, 8).map((name, j) => ({
      selectionId: 100 + i * 10 + j,
      name: `${name} ${i + 1}`,
      initialPrice: 2.5 + j * 1.5, // 2.5, 4.0, 5.5, ..., 13.0
    }));

    client.addMarket({
      marketId,
      marketName: `R${i + 1} ${course.name} Scalp Test`,
      eventName: `${14 + i}:30 ${course.name}`,
      startTime,
      country: course.country,
      raceType: "flat",
      scenario: scenarios[i],
      runners,
    });

    // Pump totalMatched up past the scanner's minMarketVolume threshold.
    const m = client.getMarket(marketId);
    if (m) m.totalMatched = 100_000;
  });
}
