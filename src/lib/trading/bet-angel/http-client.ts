// HttpBetAngelClient — real Bet Angel JSON API client.
//
// Deferred until Milestone 5a (when you have Bet Angel Pro + Windows host +
// funded Betfair account). This stub exists so the factory can reference a
// concrete type today; every method throws until implemented. The interface
// surface is identical to MockBetAngelClient so swapping is env-only.
//
// When implementing in M5a, target: https://www.betangel.com/api-guide/
// - Default base URL: http://localhost:9000
// - Four JSON API components per PRD §4.2: Markets, Betting, Guardian,
//   Automation. We use the first three.
// - Bet Angel must be running on the same machine (or reachable over LAN)
//   and the API must be enabled in its settings.
// - Practice vs live mode is NOT reported by the API — the caller knows via
//   the BET_ANGEL_MODE env var, which the factory passes to this constructor.

import type { BetAngelClient } from "./client";
import {
  BetAngelError,
  type CancelOrderResult,
  type ClientMode,
  type GuardianMarketEntry,
  type HealthCheck,
  type ListMarketsFilter,
  type MarketDetails,
  type MarketPrices,
  type MarketSummary,
  type OrderStatus,
  type PlaceOrderRequest,
  type PlaceOrderResult,
} from "./types";

export type HttpBetAngelClientOptions = {
  baseUrl: string; // e.g. http://localhost:9000
  mode: Exclude<ClientMode, "mock">; // practice | live
  fetch?: typeof fetch; // injectable for tests
  timeoutMs?: number;
};

const NOT_IMPLEMENTED = "HttpBetAngelClient is not implemented yet — complete in Milestone 5a";

function notImplemented(method: string): never {
  throw new BetAngelError(`${NOT_IMPLEMENTED} (${method})`, "NOT_IMPLEMENTED");
}

export class HttpBetAngelClient implements BetAngelClient {
  constructor(public readonly opts: HttpBetAngelClientOptions) {}

  async healthCheck(): Promise<HealthCheck> {
    // Once implemented: GET ${baseUrl}/health (or equivalent) with a short
    // timeout; set `betAngelReachable: true` on 2xx. `mode` comes from
    // `this.opts.mode` — we do NOT trust the remote to tell us.
    return {
      ok: false,
      mode: this.opts.mode,
      betAngelReachable: false,
      details: "HttpBetAngelClient stub — real implementation lands in Milestone 5a",
    };
  }

  // ─── Markets ──────────────────────────────────────────────────────────────

  listMarkets(_filter?: ListMarketsFilter): Promise<MarketSummary[]> {
    notImplemented("listMarkets");
  }

  getMarketDetails(_marketId: string): Promise<MarketDetails> {
    notImplemented("getMarketDetails");
  }

  getMarketPrices(_marketId: string): Promise<MarketPrices> {
    notImplemented("getMarketPrices");
  }

  // ─── Betting ──────────────────────────────────────────────────────────────

  placeOrder(_req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    notImplemented("placeOrder");
  }

  cancelOrder(_betId: string): Promise<CancelOrderResult> {
    notImplemented("cancelOrder");
  }

  getOrderStatus(_betId: string): Promise<OrderStatus> {
    notImplemented("getOrderStatus");
  }

  // ─── Guardian ─────────────────────────────────────────────────────────────

  addMarketToGuardian(_marketId: string): Promise<void> {
    notImplemented("addMarketToGuardian");
  }

  removeMarketFromGuardian(_marketId: string): Promise<void> {
    notImplemented("removeMarketFromGuardian");
  }

  listGuardianMarkets(): Promise<GuardianMarketEntry[]> {
    notImplemented("listGuardianMarkets");
  }
}
