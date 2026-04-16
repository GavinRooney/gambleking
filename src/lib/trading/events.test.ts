import { describe, it, expect, beforeEach } from "vitest";
import { tradingBus, type TradingEventName, type TradingEventPayload } from "./events";

beforeEach(() => {
  tradingBus.removeAllListeners();
});

describe("tradingBus — typed emit/on", () => {
  it("delivers a market:update payload to a subscriber", () => {
    const received: TradingEventPayload<"market:update">[] = [];
    tradingBus.on("market:update", (p) => received.push(p));

    tradingBus.emit("market:update", {
      marketId: "m1",
      runners: [{ runnerId: "r1", bestBack: 3.0, bestLay: 3.05, traded: 1000 }],
      at: 1,
    });

    expect(received).toHaveLength(1);
    expect(received[0].marketId).toBe("m1");
    expect(received[0].runners[0].bestBack).toBe(3.0);
  });

  it("returns an unsubscribe function from on()", () => {
    let count = 0;
    const unsubscribe = tradingBus.on("trade:open", () => count++);

    tradingBus.emit("trade:open", {
      tradeId: "t1",
      marketId: "m1",
      runnerId: "r1",
      side: "back",
      stake: 50,
      entryPrice: 3.0,
      at: 1,
    });

    unsubscribe();

    tradingBus.emit("trade:open", {
      tradeId: "t2",
      marketId: "m1",
      runnerId: "r1",
      side: "back",
      stake: 50,
      entryPrice: 3.0,
      at: 2,
    });

    expect(count).toBe(1);
  });
});

describe("tradingBus — onAny multiplex", () => {
  it("forwards every event type with the name tag", () => {
    const seen: Array<{ name: TradingEventName; at: number }> = [];
    const unsubscribe = tradingBus.onAny((name, payload) => {
      seen.push({ name, at: payload.at });
    });

    tradingBus.emit("market:update", { marketId: "m", runners: [], at: 1 });
    tradingBus.emit("trade:open", {
      tradeId: "t",
      marketId: "m",
      runnerId: "r",
      side: "lay",
      stake: 10,
      entryPrice: 2,
      at: 2,
    });
    tradingBus.emit("trade:close", {
      tradeId: "t",
      marketId: "m",
      runnerId: "r",
      status: "greened",
      profitLoss: 1.23,
      exitReason: "profit",
      at: 3,
    });
    tradingBus.emit("session:update", {
      sessionId: "s",
      dailyPnL: 1.23,
      tradesOpened: 1,
      tradesClosed: 1,
      suspended: false,
      at: 4,
    });

    expect(seen.map((e) => e.name)).toEqual([
      "market:update",
      "trade:open",
      "trade:close",
      "session:update",
    ]);
    expect(seen.map((e) => e.at)).toEqual([1, 2, 3, 4]);

    unsubscribe();
    tradingBus.emit("market:update", { marketId: "m", runners: [], at: 5 });
    expect(seen).toHaveLength(4); // no new events after unsubscribe
  });

  it("listenerCount reflects active subscriptions", () => {
    expect(tradingBus.listenerCount("market:update")).toBe(0);
    const off = tradingBus.on("market:update", () => {});
    expect(tradingBus.listenerCount("market:update")).toBe(1);
    off();
    expect(tradingBus.listenerCount("market:update")).toBe(0);
  });

  it("is always cached on globalThis (singleton invariant)", () => {
    // Guards against regressions where the globalThis stash is skipped in
    // production — which would let a second module-evaluation create a
    // second bus and silently split listeners.
    const stashed = (globalThis as unknown as { tradingEventBus: unknown })
      .tradingEventBus;
    expect(stashed).toBe(tradingBus);
  });
});
