import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { MockBetAngelClient } from "../bet-angel/mock-client";
import type { HealthCheck } from "../bet-angel/types";
import {
  tickConnectionFailsafe,
  resetConnectionState,
  getConnectionState,
  EMERGENCY_THRESHOLD_MS,
} from "./connection-failsafe";
import { tradingBus } from "../events";

const NOW = new Date("2026-04-16T14:30:00Z");
const atOffset = (ms: number) => new Date(NOW.getTime() + ms);

async function resetDb() {
  await prisma.tradeOrder.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.tradingRunner.deleteMany({});
  await prisma.tradingMarket.deleteMany({});
  await prisma.tradingSession.deleteMany({});
}

// A MockBetAngelClient whose healthCheck can be toggled to fail on demand.
class BreakableClient extends MockBetAngelClient {
  public healthy = true;
  async healthCheck(): Promise<HealthCheck> {
    if (!this.healthy) throw new Error("simulated network failure");
    return super.healthCheck();
  }
}

async function makeActiveSession(opts?: { suspended?: boolean }) {
  return prisma.tradingSession.create({
    data: {
      date: NOW,
      mode: "mock",
      startedAt: NOW,
      suspendedAt: opts?.suspended ? NOW : null,
    },
  });
}

async function makeOpenTrade(sessionId: string) {
  const market = await prisma.tradingMarket.create({
    data: {
      betfairMarketId: "mock-1.cf",
      name: "Failsafe test",
      startTime: atOffset(30 * 60_000),
      totalMatched: 100_000,
      numRunners: 1,
      status: "trading",
    },
  });
  const runner = await prisma.tradingRunner.create({
    data: { marketId: market.id, selectionId: 1, horseName: "Target" },
  });
  return prisma.trade.create({
    data: {
      sessionId,
      marketId: market.id,
      runnerId: runner.id,
      entryBackPrice: 3.0,
      entryLayPrice: 2.98,
      stake: 10,
      status: "open",
      mode: "mock",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  resetConnectionState();
  tradingBus.removeAllListeners();
});

afterEach(() => {
  tradingBus.removeAllListeners();
});

describe("connection-failsafe — happy path", () => {
  it("stays connected when healthCheck succeeds", async () => {
    const client = new BreakableClient({ seed: 1 });
    await tickConnectionFailsafe(client, NOW);
    expect(getConnectionState().status).toBe("connected");
  });
});

describe("connection-failsafe — outage state machine", () => {
  it("transitions to disconnected on first failed healthCheck", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    await tickConnectionFailsafe(client, NOW);
    const s = getConnectionState();
    expect(s.status).toBe("disconnected");
    expect(s.disconnectedSinceMs).toBe(NOW.getTime());
    expect(s.retryCount).toBe(1);
  });

  it("increments retry count across ticks while disconnected", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(1_500));
    await tickConnectionFailsafe(client, atOffset(3_000));
    expect(getConnectionState().retryCount).toBe(3);
  });

  it("throttles probes to at most once per second", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    await tickConnectionFailsafe(client, NOW); // probe
    await tickConnectionFailsafe(client, atOffset(100)); // skipped
    await tickConnectionFailsafe(client, atOffset(500)); // skipped
    await tickConnectionFailsafe(client, atOffset(1_500)); // probe
    expect(getConnectionState().retryCount).toBe(2);
  });

  it("recovers cleanly when the client comes back", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(2_000));
    expect(getConnectionState().status).toBe("disconnected");

    client.healthy = true;
    await tickConnectionFailsafe(client, atOffset(3_500));
    const s = getConnectionState();
    expect(s.status).toBe("connected");
    expect(s.disconnectedSinceMs).toBeNull();
    expect(s.retryCount).toBe(0);
    expect(s.emergencyEmitted).toBe(false);
  });
});

describe("connection-failsafe — emergency suspension", () => {
  it("suspends the active session after >=30s outage with open positions", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    const session = await makeActiveSession();
    await makeOpenTrade(session.id);

    await tickConnectionFailsafe(client, NOW); // t=0
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 100));

    const refreshed = await prisma.tradingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshed.suspendedAt).not.toBeNull();
    expect(getConnectionState().emergencyEmitted).toBe(true);
  });

  it("does NOT escalate when there are no open positions", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    const session = await makeActiveSession();
    // No open trade inserted.

    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 100));

    const refreshed = await prisma.tradingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshed.suspendedAt).toBeNull();
    expect(getConnectionState().emergencyEmitted).toBe(false);
  });

  it("does NOT re-emit emergency on subsequent ticks of the same outage", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    const session = await makeActiveSession();
    await makeOpenTrade(session.id);

    const seen: boolean[] = [];
    tradingBus.on("session:update", (p) => seen.push(p.suspended));

    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 100));
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 2_000));
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 5_000));

    // Exactly one "suspended=true" emission for the whole outage.
    expect(seen.filter(Boolean)).toHaveLength(1);
  });

  it("recovery does NOT auto-un-suspend the session", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    const session = await makeActiveSession();
    await makeOpenTrade(session.id);

    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 100));

    // Client recovers.
    client.healthy = true;
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 2_000));

    const refreshed = await prisma.tradingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshed.suspendedAt).not.toBeNull(); // still suspended
    expect(getConnectionState().status).toBe("connected"); // but connection is fine
  });

  it("respects an already-suspended session (no double-stamp)", async () => {
    const client = new BreakableClient({ seed: 1 });
    client.healthy = false;
    const session = await makeActiveSession({ suspended: true });
    await makeOpenTrade(session.id);
    const originalSuspendedAt = session.suspendedAt;

    await tickConnectionFailsafe(client, NOW);
    await tickConnectionFailsafe(client, atOffset(EMERGENCY_THRESHOLD_MS + 100));

    const refreshed = await prisma.tradingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(refreshed.suspendedAt).toEqual(originalSuspendedAt);
  });
});
