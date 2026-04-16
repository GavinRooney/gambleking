// In-process event bus for the trading engine.
//
// Engine code emits events; SSE handlers and session-stats aggregators
// subscribe. Stashed on globalThis so Next.js hot reload during development
// doesn't leave orphaned listeners (same pattern as `src/lib/db.ts`).

import { EventEmitter } from "node:events";

export type TradingEventMap = {
  "market:update": {
    marketId: string;
    runners: Array<{
      runnerId: string;
      bestBack: number | null;
      bestLay: number | null;
      traded: number;
    }>;
    at: number;
  };
  "trade:open": {
    tradeId: string;
    marketId: string;
    runnerId: string;
    side: "back" | "lay"; // which leg opened first
    stake: number;
    entryPrice: number;
    at: number;
  };
  "trade:close": {
    tradeId: string;
    marketId: string;
    runnerId: string;
    status: "matched" | "stopped" | "greened" | "forced_exit";
    profitLoss: number;
    exitReason: "profit" | "stop_loss" | "forced_exit" | null;
    at: number;
  };
  "session:update": {
    sessionId: string;
    dailyPnL: number;
    tradesOpened: number;
    tradesClosed: number;
    suspended: boolean;
    at: number;
  };
};

export type TradingEventName = keyof TradingEventMap;
export type TradingEventPayload<N extends TradingEventName> = TradingEventMap[N];

type Listener<N extends TradingEventName> = (payload: TradingEventPayload<N>) => void;

class TradingEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE subscribers + engine listeners without Node's default-10
    // warning. Still finite so a leak will eventually surface.
    this.emitter.setMaxListeners(100);
  }

  emit<N extends TradingEventName>(name: N, payload: TradingEventPayload<N>): void {
    this.emitter.emit(name, payload);
  }

  on<N extends TradingEventName>(name: N, listener: Listener<N>): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }

  off<N extends TradingEventName>(name: N, listener: Listener<N>): void {
    this.emitter.off(name, listener);
  }

  // Subscribe to every event type. Useful for the SSE endpoint which
  // forwards a multiplexed stream to the UI. Returns an unsubscribe fn.
  onAny(
    listener: <N extends TradingEventName>(
      name: N,
      payload: TradingEventPayload<N>
    ) => void
  ): () => void {
    const names: TradingEventName[] = [
      "market:update",
      "trade:open",
      "trade:close",
      "session:update",
    ];
    const wrapped = names.map((name) => {
      const fn = (p: TradingEventPayload<typeof name>) => listener(name, p);
      this.emitter.on(name, fn);
      return { name, fn };
    });
    return () => wrapped.forEach(({ name, fn }) => this.emitter.off(name, fn));
  }

  listenerCount(name: TradingEventName): number {
    return this.emitter.listenerCount(name);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

// Always stash on globalThis, regardless of NODE_ENV. Unlike a Prisma client
// (where a second instance would waste a connection pool but still work), a
// second EventEmitter would silently route some emits to listeners on the
// wrong bus — a functional bug, not a resource leak. In rare environments
// (bundler chunk-splitting, mixed Node+Edge runtimes, test harnesses re-
// importing modules) a production module can be evaluated more than once;
// always-stashing keeps the singleton correct there too.
const globalForBus = globalThis as unknown as {
  tradingEventBus: TradingEventBus | undefined;
};

if (!globalForBus.tradingEventBus) {
  globalForBus.tradingEventBus = new TradingEventBus();
}

export const tradingBus: TradingEventBus = globalForBus.tradingEventBus;
