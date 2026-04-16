// BetAngelClient — the one interface all execution code talks to.
//
// Implemented by MockBetAngelClient (in-process synthetic markets) and
// HttpBetAngelClient (real Bet Angel JSON API on port 9000). The factory in
// `./index.ts` picks one based on BET_ANGEL_MODE.
//
// Method groups mirror PRD §4.2: Markets, Betting, Guardian. Automation is
// deferred — the engine is our automation, we don't invoke Bet Angel's.

import type {
  CancelOrderResult,
  GuardianMarketEntry,
  HealthCheck,
  ListMarketsFilter,
  MarketDetails,
  MarketPrices,
  MarketSummary,
  OrderStatus,
  PlaceOrderRequest,
  PlaceOrderResult,
} from "./types";

export interface BetAngelClient {
  // ─── Connection ─────────────────────────────────────────────────────────
  healthCheck(): Promise<HealthCheck>;

  // ─── Markets ────────────────────────────────────────────────────────────
  listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]>;
  getMarketDetails(marketId: string): Promise<MarketDetails>;
  getMarketPrices(marketId: string): Promise<MarketPrices>;

  // ─── Betting ────────────────────────────────────────────────────────────
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(betId: string): Promise<CancelOrderResult>;
  getOrderStatus(betId: string): Promise<OrderStatus>;

  // ─── Guardian ───────────────────────────────────────────────────────────
  addMarketToGuardian(marketId: string): Promise<void>;
  removeMarketFromGuardian(marketId: string): Promise<void>;
  listGuardianMarkets(): Promise<GuardianMarketEntry[]>;
}

// Re-export the domain types so consumers can `import { BetAngelClient, MarketPrices } from "@/lib/trading/bet-angel/client"`.
export type * from "./types";
