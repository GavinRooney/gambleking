import type { GoingReport } from "./types";

// ─── Sporting Life scraper stubs ─────────────────────────────────────────────
//
// Sporting Life (sportinglife.com) provides:
//   - Going reports:  https://www.sportinglife.com/racing/going
//     We'd scrape the going table that lists each course and its latest
//     official going description (e.g. "Good to Soft (Soft in places)").
//
//   - Race replays:   https://www.sportinglife.com/racing/results/...
//     Each result page embeds an <iframe> or <video> tag for the replay.
//     We'd extract that URL so users can watch replays inline.
//
// These are stubs for now. Real implementation would use a headless browser
// (e.g. Playwright) or parse the HTML with a lightweight parser since the
// content is mostly server-rendered.

/**
 * Fetch the latest going report for a given course.
 *
 * TODO: Implement by scraping https://www.sportinglife.com/racing/going
 *       Parse the table rows to find the row matching `courseName`,
 *       then extract the going description and last-updated timestamp.
 *
 * @param courseName  e.g. "Ascot", "Cheltenham"
 * @returns           GoingReport or null if unavailable
 */
export async function fetchGoingReport(
  courseName: string
): Promise<GoingReport | null> {
  // Stub — return null until scraper is built
  console.log(
    `[sporting-life] fetchGoingReport stub called for "${courseName}"`
  );
  return null;
}

/**
 * Fetch the replay URL for a specific race.
 *
 * TODO: Implement by scraping the Sporting Life results page:
 *       https://www.sportinglife.com/racing/results/{date}/{course}/{race}
 *       Look for the embedded video/iframe source URL.
 *
 * @param raceName  The name of the race, e.g. "2:30 Ascot"
 * @param date      ISO date string YYYY-MM-DD
 * @returns         URL string or null if not available
 */
export async function fetchReplayUrl(
  raceName: string,
  date: string
): Promise<string | null> {
  // Stub — return null until scraper is built
  console.log(
    `[sporting-life] fetchReplayUrl stub called for "${raceName}" on ${date}`
  );
  return null;
}
