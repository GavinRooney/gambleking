// MockBetAngelClient — in-process synthetic Betfair-like market simulator.
//
// Drives M1–M4 development and CI. Exposes the full BetAngelClient surface:
// engine and tests treat it identically to the real HttpBetAngelClient.
//
// Each market has a "true price" per runner that follows a configurable walk
// (stable / drifting / steaming / thin-book). Order book depth is built
// around that true price. Orders submitted via placeOrder() sit on the book;
// they match when the market crosses their price on a later tick. No side
// effects reach the trading event bus — that's the engine's job.

import { nearestTick, addTicks, MIN_PRICE, MAX_PRICE } from "../ticks";
import type { BetAngelClient } from "./client";
import {
  BetAngelError,
  type CancelOrderResult,
  type Country,
  type GuardianMarketEntry,
  type HealthCheck,
  type ListMarketsFilter,
  type MarketDetails,
  type MarketPrices,
  type MarketSummary,
  type OrderStatus,
  type PlaceOrderRequest,
  type PlaceOrderResult,
  type PriceLevel,
  type RunnerInfo,
} from "./types";

export type ScenarioType = "stable" | "drifting" | "steaming" | "thin-book";

export type MockMarketConfig = {
  marketId: string;
  marketName: string;
  eventName: string;
  startTime: Date;
  courseName?: string;
  country?: Country;
  raceType?: MarketSummary["raceType"];
  scenario?: ScenarioType;
  runners: Array<{
    selectionId: number;
    name: string;
    initialPrice: number; // "true" price seed, will be snapped to ladder
  }>;
};

export type MockBetAngelClientOptions = {
  seed?: number;
  autoTickMs?: number; // undefined = off; tests use step() manually
};

type InternalRunner = {
  selectionId: number;
  name: string;
  truePrice: number;       // float, updated each tick
  status: "ACTIVE" | "REMOVED" | "WINNER" | "LOSER";
  totalMatched: number;
  lastTraded?: number;
};

type InternalMarket = {
  config: Required<Pick<MockMarketConfig, "marketId" | "marketName" | "eventName" | "startTime">> & MockMarketConfig;
  scenario: ScenarioType;
  runners: Map<number, InternalRunner>;
  totalMatched: number;
  status: "OPEN" | "SUSPENDED" | "CLOSED";
};

type InternalOrder = {
  betId: string;
  marketId: string;
  selectionId: number;
  side: "back" | "lay";
  price: number;
  size: number;
  sizeMatched: number;
  sizeCancelled: number;
  customerOrderRef?: string;
  placedAt: Date;
  lastMatchedAt?: Date;
  averagePriceMatched?: number;
  // "EXECUTABLE" until fully matched or cancelled, then "EXECUTION_COMPLETE"
  state: "EXECUTABLE" | "EXECUTION_COMPLETE" | "CANCELLED";
};

// Deterministic PRNG (mulberry32) so tests can seed and get reproducible walks.
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockBetAngelClient implements BetAngelClient {
  private markets = new Map<string, InternalMarket>();
  private orders = new Map<string, InternalOrder>();
  private guardian = new Map<string, Date>();
  private rand: () => number;
  private tickHandle: NodeJS.Timeout | null = null;
  private nextBetId = 1;
  private tickCount = 0;

  constructor(private readonly opts: MockBetAngelClientOptions = {}) {
    this.rand = makePrng(opts.seed ?? 0xc0ffee);
  }

  // ─── Scenario control (mock-only) ─────────────────────────────────────────

  // Register a synthetic market. Deliberately permissive about startTime — the
  // mock is a test fixture and tests for pre-race exit / forced-exit logic
  // legitimately need to construct markets starting in the past or seconds
  // from now. Business-logic validation of "is this market tradeable right
  // now" belongs in the engine's market scanner (PRD §6.1), not here.
  //
  // The checks below catch data-integrity issues that would corrupt internal
  // state and make later behaviour mysterious: duplicate markets, empty
  // runner lists, duplicate selection IDs, prices outside the Betfair ladder.
  addMarket(cfg: MockMarketConfig): void {
    if (this.markets.has(cfg.marketId)) {
      throw new BetAngelError(
        `Market ${cfg.marketId} already registered — call removeMarket() first`,
        "DUPLICATE_MARKET"
      );
    }
    if (cfg.runners.length === 0) {
      throw new BetAngelError(
        `Market ${cfg.marketId} must have at least one runner`,
        "EMPTY_RUNNERS"
      );
    }
    const seenSelectionIds = new Set<number>();
    for (const r of cfg.runners) {
      if (seenSelectionIds.has(r.selectionId)) {
        throw new BetAngelError(
          `Duplicate selectionId ${r.selectionId} in market ${cfg.marketId}`,
          "DUPLICATE_SELECTION"
        );
      }
      seenSelectionIds.add(r.selectionId);
      if (!Number.isFinite(r.initialPrice) || r.initialPrice < MIN_PRICE || r.initialPrice > MAX_PRICE) {
        throw new BetAngelError(
          `Runner ${r.selectionId} initialPrice ${r.initialPrice} is outside the Betfair ladder [${MIN_PRICE}, ${MAX_PRICE}]`,
          "INVALID_PRICE"
        );
      }
    }

    const runners = new Map<number, InternalRunner>();
    for (const r of cfg.runners) {
      runners.set(r.selectionId, {
        selectionId: r.selectionId,
        name: r.name,
        truePrice: r.initialPrice, // continuous float; snap only when building the book
        status: "ACTIVE",
        totalMatched: 0,
      });
    }
    this.markets.set(cfg.marketId, {
      config: { country: "GB", ...cfg } as InternalMarket["config"],
      scenario: cfg.scenario ?? "stable",
      runners,
      totalMatched: 0,
      status: "OPEN",
    });
  }

  removeMarket(marketId: string): void {
    this.markets.delete(marketId);
    this.guardian.delete(marketId);
  }

  setScenario(marketId: string, scenario: ScenarioType): void {
    const m = this.requireMarket(marketId);
    m.scenario = scenario;
  }

  setMarketStatus(marketId: string, status: "OPEN" | "SUSPENDED" | "CLOSED"): void {
    this.requireMarket(marketId).status = status;
  }

  getMarket(marketId: string): InternalMarket | undefined {
    return this.markets.get(marketId);
  }

  getOrder(betId: string): InternalOrder | undefined {
    return this.orders.get(betId);
  }

  // ─── Time control (mock-only) ─────────────────────────────────────────────

  // Advance all markets one tick. Test code drives this directly; production
  // can start() a setInterval to do it on a timer.
  step(): void {
    this.tickCount++;
    for (const market of this.markets.values()) {
      if (market.status !== "OPEN") continue;
      this.advanceMarket(market);
      this.tryMatchMarketOrders(market);
    }
  }

  start(): void {
    if (this.tickHandle || !this.opts.autoTickMs) return;
    this.tickHandle = setInterval(() => this.step(), this.opts.autoTickMs);
  }

  // Stop the auto-tick interval. State (markets, orders, guardian) is
  // preserved — stop() is a pause, not a wipe. Use reset() to clear state.
  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  // Restore the client to a blank slate. Intended for:
  //   - per-test isolation when the client is shared as a test fixture
  //   - an admin-triggered "wipe paper-trading" action in dev/practice mode
  //   - recovering from hot-reload edge cases where in-memory state has
  //     diverged from what the engine expects
  // Stops the tick loop first to avoid races with any in-flight step().
  reset(): void {
    this.stop();
    this.markets.clear();
    this.orders.clear();
    this.guardian.clear();
    this.nextBetId = 1;
    this.tickCount = 0;
  }

  // ─── Price movement per scenario ──────────────────────────────────────────

  private advanceMarket(market: InternalMarket): void {
    for (const runner of market.runners.values()) {
      if (runner.status !== "ACTIVE") continue;
      runner.truePrice = this.advancePrice(runner.truePrice, market.scenario);
    }
  }

  private advancePrice(price: number, scenario: ScenarioType): number {
    const noise = (this.rand() - 0.5) * 2; // [-1, 1]
    const drift = scenario === "drifting" ? 0.003 : scenario === "steaming" ? -0.003 : 0;
    // Noise amplitude: stable/thin-book are tight, drifting/steaming wider.
    const vol = scenario === "stable" || scenario === "thin-book" ? 0.002 : 0.004;
    // Keep truePrice continuous — snapping to the ladder here would erase
    // small sub-tick movements and make drifting/steaming scenarios stall
    // at coarse-tick prices. The book-building step snaps on read.
    return price * (1 + drift + noise * vol);
  }

  // ─── Order book construction ──────────────────────────────────────────────

  // Single source of truth for the synthetic spread around a runner's true
  // price. buildBook() and tryMatchOrder() both consult this so they can
  // never drift apart if the spread logic changes (e.g. if we ever widen
  // the spread for thin-book scenarios).
  private synthSpread(runner: InternalRunner): { bestBackPrice: number; bestLayPrice: number } {
    // truePrice is a continuous float; snap to the nearest valid tick and
    // open a 2-tick spread around it. Betfair convention:
    //   availableToBack = prices a NEW backer can back at = resting LAY orders
    //   availableToLay  = prices a NEW layer can lay at   = resting BACK orders
    // Best-back (highest you can back at) sits one tick below the true price;
    // best-lay (lowest you can lay at) one tick above.
    const snapped = nearestTick(runner.truePrice);
    return {
      bestBackPrice: addTicks(snapped, -1),
      bestLayPrice: addTicks(snapped, 1),
    };
  }

  private buildBook(
    market: InternalMarket,
    runner: InternalRunner
  ): { availableToBack: PriceLevel[]; availableToLay: PriceLevel[] } {
    const { bestBackPrice, bestLayPrice } = this.synthSpread(runner);

    const baseSize = market.scenario === "thin-book" ? 20 : 400;
    const levels = 5;

    const availableToBack: PriceLevel[] = [];
    const availableToLay: PriceLevel[] = [];
    for (let i = 0; i < levels; i++) {
      // Sizes decay with distance from the top of the book.
      const decay = 1 / (1 + i * 0.5);
      const size = Math.max(2, Math.round(baseSize * decay * (0.7 + this.rand() * 0.6)));
      availableToBack.push({ price: addTicks(bestBackPrice, -i), size });
      availableToLay.push({ price: addTicks(bestLayPrice, i), size });
    }

    // Merge any resting unmatched orders from our own book. A resting BACK
    // order is takeable by a new layer, so it joins availableToLay. A resting
    // LAY order is takeable by a new backer, so it joins availableToBack.
    for (const order of this.orders.values()) {
      if (
        order.marketId !== market.config.marketId ||
        order.selectionId !== runner.selectionId ||
        order.state !== "EXECUTABLE"
      ) continue;
      const remaining = order.size - order.sizeMatched - order.sizeCancelled;
      if (remaining <= 0) continue;
      const list = order.side === "back" ? availableToLay : availableToBack;
      const existing = list.find((l) => l.price === order.price);
      if (existing) existing.size += remaining;
      else list.push({ price: order.price, size: remaining });
    }
    availableToBack.sort((a, b) => b.price - a.price); // highest first
    availableToLay.sort((a, b) => a.price - b.price);  // lowest first
    return { availableToBack, availableToLay };
  }

  // ─── Order matching ───────────────────────────────────────────────────────

  private tryMatchOrder(market: InternalMarket, order: InternalOrder): void {
    if (order.state !== "EXECUTABLE") return;
    const runner = market.runners.get(order.selectionId);
    if (!runner || runner.status !== "ACTIVE") return;

    // Crossing rule: a back at price P matches if the market's current best
    // lay is ≤ P (someone is offering to lay at or below what we'd pay to
    // back). Symmetric for lay orders.
    const { bestBackPrice, bestLayPrice } = this.synthSpread(runner);
    const canMatch =
      order.side === "back"
        ? bestLayPrice <= order.price
        : bestBackPrice >= order.price;
    if (!canMatch) return;

    const remaining = order.size - order.sizeMatched - order.sizeCancelled;
    if (remaining <= 0) {
      order.state = "EXECUTION_COMPLETE";
      return;
    }

    // Fully match for simplicity — in reality partial fills are common, but
    // scalping stake sizes are small relative to book depth.
    order.sizeMatched += remaining;
    order.lastMatchedAt = new Date();
    const avgPrior = order.averagePriceMatched ?? order.price;
    order.averagePriceMatched =
      (avgPrior * (order.sizeMatched - remaining) + order.price * remaining) /
      order.sizeMatched;
    order.state = "EXECUTION_COMPLETE";

    runner.totalMatched += remaining;
    runner.lastTraded = order.price;
    market.totalMatched += remaining;
  }

  private tryMatchMarketOrders(market: InternalMarket): void {
    for (const order of this.orders.values()) {
      if (order.marketId === market.config.marketId) {
        this.tryMatchOrder(market, order);
      }
    }
  }

  // ─── BetAngelClient surface ───────────────────────────────────────────────

  async healthCheck(): Promise<HealthCheck> {
    return {
      ok: true,
      mode: "mock",
      betAngelReachable: true,
    };
  }

  async listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]> {
    const result: MarketSummary[] = [];
    for (const m of this.markets.values()) {
      if (filter?.country && !filter.country.includes(m.config.country ?? "GB")) continue;
      if (filter?.raceTypes && m.config.raceType && !filter.raceTypes.includes(m.config.raceType)) continue;
      if (filter?.fromStartTime && m.config.startTime < filter.fromStartTime) continue;
      if (filter?.toStartTime && m.config.startTime > filter.toStartTime) continue;
      if (filter?.minTotalMatched && m.totalMatched < filter.minTotalMatched) continue;
      result.push(this.toSummary(m));
    }
    return result;
  }

  async getMarketDetails(marketId: string): Promise<MarketDetails> {
    const m = this.requireMarket(marketId);
    const runners: RunnerInfo[] = Array.from(m.runners.values()).map((r) => ({
      selectionId: r.selectionId,
      name: r.name,
      status: r.status,
    }));
    return { ...this.toSummary(m), runners };
  }

  async getMarketPrices(marketId: string): Promise<MarketPrices> {
    const m = this.requireMarket(marketId);
    return {
      marketId,
      status: m.status,
      inPlay: false, // scalping is pre-race only
      totalMatched: m.totalMatched,
      at: new Date(),
      runners: Array.from(m.runners.values()).map((r) => {
        const book = this.buildBook(m, r);
        return {
          selectionId: r.selectionId,
          status: r.status,
          lastPriceTraded: r.lastTraded,
          totalMatched: r.totalMatched,
          ...book,
        };
      }),
    };
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const market = this.requireMarket(req.marketId);
    const runner = market.runners.get(req.selectionId);
    if (!runner) {
      throw new BetAngelError(`Unknown selection ${req.selectionId} in ${req.marketId}`, "UNKNOWN_RUNNER");
    }
    if (req.size <= 0 || req.price <= 1) {
      throw new BetAngelError("Invalid order: size must be > 0 and price > 1", "INVALID_ORDER");
    }

    const betId = `MOCK-${this.nextBetId++}`;
    const order: InternalOrder = {
      betId,
      marketId: req.marketId,
      selectionId: req.selectionId,
      side: req.side,
      price: req.price,
      size: req.size,
      sizeMatched: 0,
      sizeCancelled: 0,
      customerOrderRef: req.customerOrderRef,
      placedAt: new Date(),
      state: "EXECUTABLE",
    };
    this.orders.set(betId, order);

    // Try an immediate match against the current book.
    this.tryMatchOrder(market, order);

    return {
      betId,
      status: "SUCCESS",
      placedPrice: order.price,
      size: order.size,
      sizeMatched: order.sizeMatched,
      sizeRemaining: order.size - order.sizeMatched - order.sizeCancelled,
      averagePriceMatched: order.averagePriceMatched,
    };
  }

  async cancelOrder(betId: string): Promise<CancelOrderResult> {
    const order = this.orders.get(betId);
    if (!order) {
      return { betId, status: "FAILURE", sizeCancelled: 0, errorMessage: "Unknown bet" };
    }
    if (order.state !== "EXECUTABLE") {
      return { betId, status: "FAILURE", sizeCancelled: 0, errorMessage: "Order not executable" };
    }
    const remaining = order.size - order.sizeMatched - order.sizeCancelled;
    order.sizeCancelled += remaining;
    order.state = order.sizeMatched > 0 ? "EXECUTION_COMPLETE" : "CANCELLED";
    return { betId, status: "SUCCESS", sizeCancelled: remaining };
  }

  async getOrderStatus(betId: string): Promise<OrderStatus> {
    const order = this.orders.get(betId);
    if (!order) throw new BetAngelError(`Unknown bet ${betId}`, "UNKNOWN_BET");
    return {
      betId,
      marketId: order.marketId,
      selectionId: order.selectionId,
      side: order.side,
      price: order.price,
      size: order.size,
      sizeMatched: order.sizeMatched,
      sizeRemaining: order.size - order.sizeMatched - order.sizeCancelled,
      sizeCancelled: order.sizeCancelled,
      averagePriceMatched: order.averagePriceMatched,
      status: order.state,
      placedAt: order.placedAt,
      lastMatchedAt: order.lastMatchedAt,
    };
  }

  async addMarketToGuardian(marketId: string): Promise<void> {
    this.requireMarket(marketId);
    if (!this.guardian.has(marketId)) this.guardian.set(marketId, new Date());
  }

  async removeMarketFromGuardian(marketId: string): Promise<void> {
    this.guardian.delete(marketId);
  }

  async listGuardianMarkets(): Promise<GuardianMarketEntry[]> {
    return Array.from(this.guardian.entries()).map(([marketId, addedAt]) => ({
      marketId,
      addedAt,
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private requireMarket(marketId: string): InternalMarket {
    const m = this.markets.get(marketId);
    if (!m) throw new BetAngelError(`Unknown market ${marketId}`, "UNKNOWN_MARKET");
    return m;
  }

  private toSummary(m: InternalMarket): MarketSummary {
    return {
      marketId: m.config.marketId,
      marketName: m.config.marketName,
      eventName: m.config.eventName,
      startTime: m.config.startTime,
      totalMatched: m.totalMatched,
      numRunners: m.runners.size,
      courseName: m.config.courseName,
      country: m.config.country ?? "GB",
      raceType: m.config.raceType,
    };
  }
}
