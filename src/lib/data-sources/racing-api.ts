import type { RacingApiRaceCard, RacingApiResult } from "./types";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_USERNAME = process.env.RACING_API_USERNAME ?? "";
const API_PASSWORD = process.env.RACING_API_PASSWORD ?? "";
const BASE_URL = "https://api.theracingapi.com/v1";

function headers(): HeadersInit {
  if (!API_USERNAME || !API_PASSWORD) {
    throw new Error(
      "RACING_API_USERNAME and RACING_API_PASSWORD are not set. " +
        "Sign up at https://www.theracingapi.com and add credentials to .env"
    );
  }
  const credentials = Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString(
    "base64"
  );
  return {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
  };
}

// ─── Generic fetcher ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), { headers: headers() });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(
      `Racing API ${res.status} ${res.statusText} — ${url}\n${body}`
    );
  }

  const json = await res.json();
  return json as T;
}

// ─── Public functions ────────────────────────────────────────────────────────

/**
 * Fetch race cards for a given date.
 *
 * The Racing API only supports day=today and day=tomorrow for racecards.
 * For a specific YYYY-MM-DD date, we map it to today/tomorrow if it matches,
 * otherwise return empty (past racecards aren't available — use fetchResults instead).
 */
export async function fetchRaceCards(
  date: "today" | "tomorrow" | string
): Promise<RacingApiRaceCard[]> {
  const params: Record<string, string> = {};

  if (date === "today" || date === "tomorrow") {
    params.day = date;
  } else {
    // Map YYYY-MM-DD to today/tomorrow if applicable
    const today = new Date().toISOString().split("T")[0];
    const tmrw = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

    if (date === today) {
      params.day = "today";
    } else if (date === tmrw) {
      params.day = "tomorrow";
    } else {
      // The API doesn't support arbitrary date racecards — return empty
      console.log(`[Racing API] Racecards only available for today/tomorrow, not ${date}`);
      return [];
    }
  }

  const data = await apiFetch<
    RacingApiRaceCard[] | { racecards: RacingApiRaceCard[] }
  >("/racecards", params);

  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && "racecards" in data) {
    return data.racecards;
  }

  console.warn("Unexpected race cards response shape, returning empty array");
  return [];
}

/**
 * Fetch results for a given date.
 * @param date  "today" | "YYYY-MM-DD"
 */
export async function fetchResults(
  date: "today" | string
): Promise<RacingApiResult[]> {
  const params: Record<string, string> = {};
  if (date === "today") {
    params.day = "today";
  } else {
    params.date = date;
  }

  const data = await apiFetch<
    RacingApiResult[] | { results: RacingApiResult[] }
  >("/results", params);

  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && "results" in data) {
    return data.results;
  }

  console.warn("Unexpected results response shape, returning empty array");
  return [];
}

/**
 * Fetch a horse's results by horse ID.
 */
export async function fetchHorseProfile(
  horseId: string
): Promise<Record<string, unknown> | null> {
  try {
    const data = await apiFetch<Record<string, unknown>>(
      `/horses/${horseId}/results`
    );
    return data;
  } catch (err) {
    console.error(`Failed to fetch horse profile for ${horseId}:`, err);
    return null;
  }
}
