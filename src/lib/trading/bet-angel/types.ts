// Domain types exposed by any BetAngelClient implementation.
//
// These sit at a slightly higher level than the raw Bet Angel JSON shapes:
// booleans are real booleans, timestamps are Date objects, and the "Betfair
// noise" is smoothed. The HttpBetAngelClient is responsible for translating
// between this surface and the actual JSON RPC payloads documented at
// https://www.betangel.com/api-guide/ — the Mock and HTTP clients both
// emit these same types so the engine is oblivious to which it's talking to.

// ─── Markets component ──────────────────────────────────────────────────────

export type MarketStatus = "OPEN" | "SUSPENDED" | "CLOSED";
export type RunnerStatus = "ACTIVE" | "REMOVED" | "WINNER" | "LOSER";
export type Country = "GB" | "IE" | (string & {}); // open for future expansion

export type MarketSummary = {
  marketId: string;        // Betfair market ID, e.g. "1.234567890"
  marketName: string;      // e.g. "R1 2m Hcap Hrd"
  eventName: string;       // e.g. "14:30 Ascot"
  startTime: Date;
  totalMatched: number;    // £ matched in-market
  numRunners: number;
  courseName?: string;     // "Ascot", "Leopardstown" — optional; parsed from eventName when absent
  country: Country;
  raceType?: "flat" | "hurdle" | "chase" | "bumper";
};

export type RunnerInfo = {
  selectionId: number;
  name: string;
  status: RunnerStatus;
  sortPriority?: number;
};

export type MarketDetails = MarketSummary & {
  runners: RunnerInfo[];
};

export type PriceLevel = {
  price: number;
  size: number;
};

export type RunnerPrices = {
  selectionId: number;
  status: RunnerStatus;
  lastPriceTraded?: number;
  totalMatched: number;
  /**
   * Prices at which you can BACK this runner, populated by other traders'
   * resting LAY orders. Ordered best-first = highest price first (a higher
   * price pays the backer more on a win). Matches Betfair API's
   * `availableToBack`.
   */
  availableToBack: PriceLevel[];
  /**
   * Prices at which you can LAY this runner, populated by other traders'
   * resting BACK orders. Ordered best-first = lowest price first (a lower
   * price means less liability on a win for the layer). Matches Betfair
   * API's `availableToLay`.
   */
  availableToLay: PriceLevel[];
};

export type MarketPrices = {
  marketId: string;
  status: MarketStatus;
  inPlay: boolean;
  totalMatched: number;
  at: Date;
  runners: RunnerPrices[];
};

export type ListMarketsFilter = {
  country?: Country[];
  raceTypes?: Array<NonNullable<MarketSummary["raceType"]>>;
  fromStartTime?: Date;
  toStartTime?: Date;
  minTotalMatched?: number;
};

// ─── Betting component ──────────────────────────────────────────────────────

export type OrderSide = "back" | "lay";

// Betfair persistence types; Bet Angel passes them through.
// LAPSE: cancel at turn-in-play (safest for pre-race scalping).
// PERSIST: leave in market in-play (we will never use this).
// MARKET_ON_CLOSE: convert to SP at turn-in-play.
export type PersistenceType = "LAPSE" | "PERSIST" | "MARKET_ON_CLOSE";

export type PlaceOrderRequest = {
  marketId: string;
  selectionId: number;
  side: OrderSide;
  price: number;
  size: number;
  persistenceType?: PersistenceType; // default LAPSE
  customerOrderRef?: string;         // correlate with our internal trade ID
};

export type PlaceOrderOutcome = "SUCCESS" | "FAILURE" | "PENDING";

export type PlaceOrderResult = {
  betId: string;                     // Bet Angel / Betfair bet ID
  status: PlaceOrderOutcome;
  placedPrice: number;
  size: number;
  sizeMatched: number;
  sizeRemaining: number;
  averagePriceMatched?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type CancelOrderResult = {
  betId: string;
  status: "SUCCESS" | "FAILURE";
  sizeCancelled: number;
  errorMessage?: string;
};

export type OrderExecutionStatus =
  | "EXECUTABLE"         // live on the book, partially or fully unmatched
  | "EXECUTION_COMPLETE" // fully matched or fully cancelled
  | "CANCELLED";

export type OrderStatus = {
  betId: string;
  marketId: string;
  selectionId: number;
  side: OrderSide;
  price: number;
  size: number;
  sizeMatched: number;
  sizeRemaining: number;
  sizeCancelled: number;
  averagePriceMatched?: number;
  status: OrderExecutionStatus;
  placedAt: Date;
  lastMatchedAt?: Date;
};

// ─── Guardian component ─────────────────────────────────────────────────────

// Guardian is Bet Angel's multi-market watchlist. The strategy engine
// populates it with the day's qualifying races so Bet Angel refreshes prices
// for all of them in parallel.

export type GuardianMarketEntry = {
  marketId: string;
  addedAt: Date;
};

// ─── Automation component (deferred — minimal surface for now) ──────────────

// We don't use Bet Angel's native automation rules; the strategy engine runs
// in Node. This type is here so the interface shape stays aligned with
// PRD §4.2's four-component model, for future use.
export type AutomationRuleRef = {
  ruleId: string;
  name: string;
};

// ─── Connection status ──────────────────────────────────────────────────────

export type ClientMode = "mock" | "practice" | "live";

export type HealthCheck = {
  ok: boolean;
  mode: ClientMode;       // from our env var, not the API — Bet Angel's JSON API does not report this
  betAngelReachable: boolean;
  details?: string;
};

// ─── Errors ─────────────────────────────────────────────────────────────────

export class BetAngelError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "BetAngelError";
  }
}
