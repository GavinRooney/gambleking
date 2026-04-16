// Connection-loss failsafe — PRD §7.5.
//
// Runs every tick. Calls BetAngelClient.healthCheck() and tracks outage state
// in a process-local struct. If the client has been unreachable for ≥ 30s
// AND the session has open positions, we escalate to "emergency": the
// session is suspended (which blocks new trades; existing open trades will
// still close naturally or via pre-race-exit) and a diagnostic is logged.
//
// For now the failsafe is defensive plumbing — the mock client never fails
// healthCheck in normal operation, so this effectively runs idle. It wakes
// up when HttpBetAngelClient lands in M5a and actually talks to Bet Angel
// over HTTP, at which point network flakes become real.
//
// Design notes:
//   - Minimal backoff: we only probe once per second even though the engine
//     ticks every 500 ms. Avoids hammering a struggling endpoint.
//   - Emergency fires at most once per outage. State resets on reconnect.
//   - Reconnection does NOT auto-un-suspend the session — the user decides
//     whether to stopSession + startSession or let it ride.

import { prisma } from "@/lib/db";
import type { BetAngelClient } from "../bet-angel/client";
import { tradingBus } from "../events";

export const EMERGENCY_THRESHOLD_MS = 30_000;
const PROBE_INTERVAL_MS = 1_000;

type FailsafeState = {
  status: "connected" | "disconnected";
  disconnectedSinceMs: number | null;
  lastProbeMs: number;
  retryCount: number;
  emergencyEmitted: boolean;
};

const initialState: FailsafeState = {
  status: "connected",
  disconnectedSinceMs: null,
  lastProbeMs: 0,
  retryCount: 0,
  emergencyEmitted: false,
};

const globalForFailsafe = globalThis as unknown as {
  connectionFailsafeState: FailsafeState | undefined;
};
if (!globalForFailsafe.connectionFailsafeState) {
  globalForFailsafe.connectionFailsafeState = { ...initialState };
}
const state = globalForFailsafe.connectionFailsafeState;

export function getConnectionState(): Readonly<FailsafeState> {
  return { ...state };
}

export function resetConnectionState(): void {
  state.status = "connected";
  state.disconnectedSinceMs = null;
  state.lastProbeMs = 0;
  state.retryCount = 0;
  state.emergencyEmitted = false;
}

export async function tickConnectionFailsafe(
  client: BetAngelClient,
  now: Date = new Date()
): Promise<void> {
  const ts = now.getTime();

  // Back off the actual probe to at most once per second. Every other tick
  // we still re-check emergency condition against existing state.
  const shouldProbe = ts - state.lastProbeMs >= PROBE_INTERVAL_MS;

  if (shouldProbe) {
    state.lastProbeMs = ts;
    try {
      const health = await client.healthCheck();
      if (!health.ok || !health.betAngelReachable) {
        throw new Error(health.details ?? "health check reports not OK");
      }
      if (state.status === "disconnected") {
        // Recovered.
        state.status = "connected";
        state.disconnectedSinceMs = null;
        state.retryCount = 0;
        state.emergencyEmitted = false;
      }
    } catch {
      if (state.status === "connected") {
        state.status = "disconnected";
        state.disconnectedSinceMs = ts;
        state.retryCount = 1;
      } else {
        state.retryCount += 1;
      }
    }
  }

  // Emergency check: fires once per outage after EMERGENCY_THRESHOLD_MS of
  // continuous disconnection, but only if we actually have open positions
  // that could move against us while we're blind.
  if (
    state.status === "disconnected" &&
    state.disconnectedSinceMs !== null &&
    !state.emergencyEmitted &&
    ts - state.disconnectedSinceMs >= EMERGENCY_THRESHOLD_MS
  ) {
    const openCount = await prisma.trade.count({ where: { status: "open" } });
    if (openCount > 0) {
      await triggerEmergency(now);
      state.emergencyEmitted = true;
    }
  }
}

async function triggerEmergency(now: Date): Promise<void> {
  const active = await prisma.tradingSession.findFirst({
    where: { endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!active) {
    console.error(
      "[connection-failsafe] EMERGENCY: client unreachable >=30s with open positions, but no active session found"
    );
    return;
  }
  if (active.suspendedAt !== null) return; // already suspended by another guard

  const suspended = await prisma.tradingSession.update({
    where: { id: active.id },
    data: { suspendedAt: now },
  });
  console.error(
    "[connection-failsafe] EMERGENCY: client unreachable >=30s with open positions — session suspended"
  );
  tradingBus.emit("session:update", {
    sessionId: suspended.id,
    dailyPnL: suspended.dailyPnL,
    tradesOpened: suspended.tradesOpened,
    tradesClosed: suspended.tradesClosed,
    suspended: true,
    at: now.getTime(),
  });
}
