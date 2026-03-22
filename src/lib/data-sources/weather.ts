import type { WeatherForecast } from "./types";

// ─── Racecourse coordinates ──────────────────────────────────────────────────
// Latitude / longitude for major UK and Ireland courses.

interface LatLng {
  lat: number;
  lng: number;
}

const COURSE_COORDS: Record<string, LatLng> = {
  // UK
  ascot:          { lat: 51.4106, lng: -0.6747 },
  cheltenham:     { lat: 51.9186, lng: -2.0681 },
  aintree:        { lat: 53.4763, lng: -2.9521 },
  epsom:          { lat: 51.3226, lng: -0.2617 },
  newmarket:      { lat: 52.2441, lng:  0.3710 },
  york:           { lat: 53.9517, lng: -1.0947 },
  goodwood:       { lat: 50.8949, lng: -0.7528 },
  doncaster:      { lat: 53.5184, lng: -1.1098 },
  kempton:        { lat: 51.4074, lng: -0.4086 },
  sandown:        { lat: 51.3656, lng: -0.3586 },
  haydock:        { lat: 53.4781, lng: -2.6387 },
  lingfield:      { lat: 51.1714, lng: -0.0227 },
  newbury:        { lat: 51.4012, lng: -1.3160 },
  chester:        { lat: 53.1830, lng: -2.8946 },
  wolverhampton:  { lat: 52.5958, lng: -2.1330 },
  wetherby:       { lat: 53.9310, lng: -1.3840 },
  musselburgh:    { lat: 55.9422, lng: -3.0615 },
  ayr:            { lat: 55.4620, lng: -4.6270 },
  fontwell:       { lat: 50.8563, lng: -0.6514 },
  newcastle:      { lat: 54.9924, lng: -1.7229 },
  southwell:      { lat: 53.0753, lng: -0.9010 },
  uttoxeter:      { lat: 52.8963, lng: -1.8622 },
  catterick:      { lat: 54.3740, lng: -1.6458 },
  carlisle:       { lat: 54.8926, lng: -2.9157 },
  bath:           { lat: 51.3980, lng: -2.3485 },
  brighton:       { lat: 50.8452, lng: -0.1179 },
  warwick:        { lat: 52.2812, lng: -1.5916 },
  plumpton:       { lat: 50.8990, lng: -0.0540 },
  huntingdon:     { lat: 52.3366, lng: -0.1744 },
  market_rasen:   { lat: 53.3900, lng: -0.3345 },
  sedgefield:     { lat: 54.6524, lng: -1.4587 },
  stratford:      { lat: 52.1936, lng: -1.7153 },
  windsor:        { lat: 51.4842, lng: -0.6122 },
  bangor:         { lat: 53.2145, lng: -3.9810 },
  hexham:         { lat: 54.9704, lng: -2.0917 },
  kelso:          { lat: 55.5989, lng: -2.4346 },
  perth:          { lat: 56.4073, lng: -3.4474 },
  // Ireland
  leopardstown:   { lat: 53.2740, lng: -6.2040 },
  curragh:        { lat: 53.1487, lng: -6.7505 },
  fairyhouse:     { lat: 53.5258, lng: -6.5663 },
  punchestown:    { lat: 53.1683, lng: -6.6500 },
  galway:         { lat: 53.2995, lng: -8.7565 },
};

/**
 * Normalize a course name to a lookup key.
 * "Kempton Park" -> "kempton", "The Curragh" -> "curragh", etc.
 */
function normalizeCourseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s*\(aw\)\s*/i, "")
    .replace(/\s+(park|downs|racecourse)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .trim();
}

function findCoords(courseName: string): LatLng | null {
  const key = normalizeCourseName(courseName);
  return COURSE_COORDS[key] ?? null;
}

// ─── Open-Meteo fetch ────────────────────────────────────────────────────────

/**
 * Fetch weather forecast for a specific racecourse and date.
 * Uses Open-Meteo (free, no API key required).
 *
 * @param courseName  Human-readable course name, e.g. "Ascot"
 * @param date        ISO date string YYYY-MM-DD
 * @returns           WeatherForecast or null if the course is not in our lookup
 */
export async function fetchWeatherForCourse(
  courseName: string,
  date: string
): Promise<WeatherForecast | null> {
  const coords = findCoords(courseName);
  if (!coords) {
    console.warn(
      `No coordinates for course "${courseName}". Add it to COURSE_COORDS.`
    );
    return null;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${coords.lat}` +
    `&longitude=${coords.lng}` +
    `&daily=precipitation_sum,temperature_2m_max,wind_speed_10m_max` +
    `&timezone=Europe/London` +
    `&start_date=${date}` +
    `&end_date=${date}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Open-Meteo ${res.status}: ${await res.text()}`);
      return null;
    }

    const json = await res.json();
    const daily = json?.daily;

    return {
      courseName,
      date,
      precipitationMm: daily?.precipitation_sum?.[0] ?? null,
      temperatureMaxC: daily?.temperature_2m_max?.[0] ?? null,
      windSpeedMaxKmh: daily?.wind_speed_10m_max?.[0] ?? null,
    };
  } catch (err) {
    console.error(`Weather fetch failed for ${courseName} on ${date}:`, err);
    return null;
  }
}
