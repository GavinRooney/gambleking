import { describe, it, expect, beforeEach } from "vitest";
import {
  BetAngelConfigError,
  getBetAngelClient,
  MockBetAngelClient,
  HttpBetAngelClient,
  readBetAngelConfig,
  resetBetAngelClientCache,
} from "./index";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
}

beforeEach(() => {
  restoreEnv();
  resetBetAngelClientCache();
});

describe("BetAngelClient factory — mode resolution", () => {
  it("defaults to mock when BET_ANGEL_MODE unset", () => {
    delete process.env.BET_ANGEL_MODE;
    const cfg = readBetAngelConfig(process.env);
    expect(cfg.mode).toBe("mock");
    expect(getBetAngelClient()).toBeInstanceOf(MockBetAngelClient);
  });

  it("accepts mode=practice and returns an HttpBetAngelClient", () => {
    process.env.BET_ANGEL_MODE = "practice";
    const client = getBetAngelClient();
    expect(client).toBeInstanceOf(HttpBetAngelClient);
    expect((client as HttpBetAngelClient).opts.mode).toBe("practice");
  });

  it("respects BET_ANGEL_URL override", () => {
    process.env.BET_ANGEL_MODE = "practice";
    process.env.BET_ANGEL_URL = "http://10.0.0.5:9001";
    const client = getBetAngelClient() as HttpBetAngelClient;
    expect(client.opts.baseUrl).toBe("http://10.0.0.5:9001");
  });

  it("rejects an unknown mode", () => {
    process.env.BET_ANGEL_MODE = "paper";
    expect(() => getBetAngelClient()).toThrow(BetAngelConfigError);
  });

  it("rejects mode=live without ARM_LIVE_TRADING=true", () => {
    process.env.BET_ANGEL_MODE = "live";
    delete process.env.ARM_LIVE_TRADING;
    expect(() => getBetAngelClient()).toThrow(/ARM_LIVE_TRADING/);

    process.env.ARM_LIVE_TRADING = "false";
    expect(() => getBetAngelClient()).toThrow(/ARM_LIVE_TRADING/);
  });

  it("allows mode=live when ARM_LIVE_TRADING=true", () => {
    process.env.BET_ANGEL_MODE = "live";
    process.env.ARM_LIVE_TRADING = "true";
    const client = getBetAngelClient();
    expect(client).toBeInstanceOf(HttpBetAngelClient);
    expect((client as HttpBetAngelClient).opts.mode).toBe("live");
  });
});

describe("BetAngelClient factory — singleton behaviour", () => {
  it("returns the same client instance across calls", () => {
    process.env.BET_ANGEL_MODE = "mock";
    const a = getBetAngelClient();
    const b = getBetAngelClient();
    expect(a).toBe(b);
  });

  it("rebuilds when mode changes", () => {
    process.env.BET_ANGEL_MODE = "mock";
    const a = getBetAngelClient();
    process.env.BET_ANGEL_MODE = "practice";
    const b = getBetAngelClient();
    expect(a).not.toBe(b);
    expect(b).toBeInstanceOf(HttpBetAngelClient);
  });

  it("refuses to return any client when ARM_LIVE_TRADING is flipped off mid-session", () => {
    process.env.BET_ANGEL_MODE = "live";
    process.env.ARM_LIVE_TRADING = "true";
    const live = getBetAngelClient();
    expect(live).toBeInstanceOf(HttpBetAngelClient);

    // Flip the safety gate off. Subsequent calls must throw — even though a
    // live client is still cached — rather than silently return it.
    process.env.ARM_LIVE_TRADING = "false";
    expect(() => getBetAngelClient()).toThrow(/ARM_LIVE_TRADING/);

    // Flipping back on returns a usable client (possibly the same cached one,
    // but either way not an error).
    process.env.ARM_LIVE_TRADING = "true";
    expect(() => getBetAngelClient()).not.toThrow();
  });
});
