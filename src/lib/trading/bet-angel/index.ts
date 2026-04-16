// BetAngelClient factory + public exports.
//
// `getBetAngelClient()` returns a singleton BetAngelClient picked by the
// BET_ANGEL_MODE env var:
//
//   mock      → MockBetAngelClient (default)
//   practice  → HttpBetAngelClient pointing at real Bet Angel (Practice Mode)
//   live      → HttpBetAngelClient pointing at real Bet Angel (live); additionally
//               requires ARM_LIVE_TRADING=true as a second safety gate.
//
// The instance is stashed on globalThis so Next.js hot-reload in development
// doesn't lose the mock's in-memory markets / orders between requests.

import type { BetAngelClient } from "./client";
import { HttpBetAngelClient } from "./http-client";
import { MockBetAngelClient } from "./mock-client";
import { type ClientMode } from "./types";

export type { BetAngelClient } from "./client";
export { MockBetAngelClient } from "./mock-client";
export { HttpBetAngelClient } from "./http-client";
export * from "./types";

export class BetAngelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetAngelConfigError";
  }
}

type ResolvedConfig = {
  mode: ClientMode;
  baseUrl: string;
  armLiveTrading: boolean;
};

function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const rawMode = (env.BET_ANGEL_MODE ?? "mock").trim().toLowerCase();
  if (rawMode !== "mock" && rawMode !== "practice" && rawMode !== "live") {
    throw new BetAngelConfigError(
      `BET_ANGEL_MODE must be "mock", "practice", or "live" (got "${rawMode}")`
    );
  }
  const mode = rawMode as ClientMode;

  const baseUrl = env.BET_ANGEL_URL?.trim() || "http://localhost:9000";
  const armLiveTrading = (env.ARM_LIVE_TRADING ?? "").trim().toLowerCase() === "true";

  if (mode === "live" && !armLiveTrading) {
    throw new BetAngelConfigError(
      "Refusing to construct a live BetAngelClient: ARM_LIVE_TRADING must be exactly \"true\" to enable live trading."
    );
  }

  return { mode, baseUrl, armLiveTrading };
}

function buildClient(cfg: ResolvedConfig): BetAngelClient {
  if (cfg.mode === "mock") {
    return new MockBetAngelClient({
      // autoTickMs left undefined — the engine's tick loop drives step()
      // explicitly so behaviour is identical in dev and tests.
    });
  }
  return new HttpBetAngelClient({
    baseUrl: cfg.baseUrl,
    mode: cfg.mode,
  });
}

type Cached = {
  client: BetAngelClient;
  mode: ClientMode;
  baseUrl: string;
  armLiveTrading: boolean;
};

const globalForBetAngel = globalThis as unknown as {
  betAngelClient: Cached | undefined;
};

export function getBetAngelClient(): BetAngelClient {
  // resolveConfig() is the primary safety gate: mode=live && !arm throws here,
  // before the cache is consulted at all. Including every config field in the
  // cache key below is defence-in-depth — if a future refactor moves the arm
  // guard out of resolveConfig, the cache can't silently return a stale live
  // client.
  const cfg = resolveConfig();
  const cached = globalForBetAngel.betAngelClient;

  if (
    cached &&
    cached.mode === cfg.mode &&
    cached.baseUrl === cfg.baseUrl &&
    cached.armLiveTrading === cfg.armLiveTrading
  ) {
    return cached.client;
  }

  const client = buildClient(cfg);
  globalForBetAngel.betAngelClient = {
    client,
    mode: cfg.mode,
    baseUrl: cfg.baseUrl,
    armLiveTrading: cfg.armLiveTrading,
  };
  return client;
}

export function getBetAngelMode(): ClientMode {
  return resolveConfig().mode;
}

// Exposed for tests and for the session-start guard in the UI: reports the
// configured mode without constructing a client (avoids side-effects).
export function readBetAngelConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  return resolveConfig(env);
}

// Exposed for tests: drop the cached singleton so the next call rebuilds.
export function resetBetAngelClientCache(): void {
  globalForBetAngel.betAngelClient = undefined;
}
