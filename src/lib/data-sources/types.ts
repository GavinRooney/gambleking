// ─── Racing API raw response types ───────────────────────────────────────────

/** A single runner as it comes back from the Racing API. */
export interface RacingApiRunner {
  horse: string;
  horse_id: string;
  age: string;
  sex: string;
  sex_code: string;
  colour: string;
  region: string;
  sire: string;
  sire_id: string;
  dam: string;
  dam_id: string;
  damsire: string;
  damsire_id: string;
  trainer: string;
  trainer_id: string;
  trainer_location: string;
  trainer_14_days: { runs: string; wins: string; percent: string };
  jockey: string;
  jockey_id: string;
  owner: string;
  owner_id: string;
  number: number;
  draw: number;
  headgear: string;
  lbs: number;
  ofr: number | string;
  rpr: number | string;
  ts: string;
  form: string;
  last_run: number | string;
  comment: string;
  spotlight: string;
  silk_url: string;
  /** Finish position (results only) */
  position?: string;
  /** Beaten distance (results only) */
  beaten_distance?: string;
  /** SP odds (results only) */
  sp?: string;
  /** Best odds (results only) */
  odds?: { decimal: string; fractional: string }[];
}

/** A single race card from the Racing API. */
export interface RacingApiRaceCard {
  race_id: string;
  course: string;
  course_id: string;
  date: string;
  off_time: string;
  off_dt: string;
  race_name: string;
  distance_round: string;
  distance: string;
  distance_f: string;
  region: string;
  pattern: string;
  race_class: string;
  type: string;
  age_band: string;
  rating_band: string;
  prize: string;
  field_size: string;
  going: string;
  going_detailed: string;
  surface: string;
  weather: string;
  stalls: string;
  big_race: boolean;
  is_abandoned: boolean;
  race_status: string;
  runners: RacingApiRunner[];
}

/** A result entry — same shape as a race card but with finish positions filled. */
export interface RacingApiResult extends RacingApiRaceCard {}

// ─── Normalized types (ready for DB storage) ─────────────────────────────────

export interface NormalizedRunner {
  horseName: string;
  horseExternalId: string;
  age: number | null;
  sex: string | null;
  sire: string | null;
  dam: string | null;
  trainerName: string | null;
  trainerExternalId: string | null;
  jockeyName: string | null;
  jockeyExternalId: string | null;
  owner: string | null;
  weightCarried: string | null;
  officialRating: number | null;
  drawPosition: number | null;
  form: string | null;
  trainerStrikeRate14d: number | null;
  oddsSp: number | null;
  oddsBest: number | null;
  finishPosition: number | null;
  beatenDistance: number | null;
}

export interface NormalizedRace {
  externalId: string;
  date: Date;
  courseName: string;
  courseExternalId: string;
  raceName: string;
  raceType: string;
  raceClass: number | null;
  distanceFurlongs: number;
  going: string | null;
  surface: string | null;
  prizeMoney: number | null;
  numRunners: number | null;
  region: string;
  runners: NormalizedRunner[];
}

// ─── Weather types ───────────────────────────────────────────────────────────

export interface WeatherForecast {
  courseName: string;
  date: string;
  precipitationMm: number | null;
  temperatureMaxC: number | null;
  windSpeedMaxKmh: number | null;
}

// ─── Sporting Life types ─────────────────────────────────────────────────────

export interface GoingReport {
  courseName: string;
  going: string;
  description: string | null;
  updatedAt: string | null;
}
