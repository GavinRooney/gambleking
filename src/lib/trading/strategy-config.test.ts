import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  STRATEGY_CONFIG_ID,
  getStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
} from "./strategy-config";

beforeEach(async () => {
  await prisma.strategyConfig.deleteMany({});
});

describe("strategy-config helpers", () => {
  it("getStrategyConfig creates the singleton with defaults on first call", async () => {
    const cfg = await getStrategyConfig();
    expect(cfg.id).toBe(STRATEGY_CONFIG_ID);
    // Spot-check a couple of PRD §8.3 defaults.
    expect(cfg.scalpStake).toBe(50);
    expect(cfg.stopLossTicks).toBe(2);
    expect(cfg.dailyLossLimit).toBe(200);
  });

  it("getStrategyConfig returns the same row on repeated calls", async () => {
    const a = await getStrategyConfig();
    const b = await getStrategyConfig();
    expect(a.id).toBe(b.id);
    const count = await prisma.strategyConfig.count();
    expect(count).toBe(1);
  });

  it("updateStrategyConfig patches only the provided fields", async () => {
    await getStrategyConfig();
    const updated = await updateStrategyConfig({ scalpStake: 75, stopLossTicks: 3 });
    expect(updated.scalpStake).toBe(75);
    expect(updated.stopLossTicks).toBe(3);
    // Untouched field stays at default.
    expect(updated.dailyLossLimit).toBe(200);
    expect(await prisma.strategyConfig.count()).toBe(1);
  });

  it("updateStrategyConfig also creates the row if missing", async () => {
    expect(await prisma.strategyConfig.count()).toBe(0);
    const cfg = await updateStrategyConfig({ scalpStake: 100 });
    expect(cfg.scalpStake).toBe(100);
    expect(await prisma.strategyConfig.count()).toBe(1);
  });

  it("resetStrategyConfig restores DB defaults", async () => {
    await updateStrategyConfig({ scalpStake: 999, dailyLossLimit: 50 });
    const reset = await resetStrategyConfig();
    expect(reset.scalpStake).toBe(50);
    expect(reset.dailyLossLimit).toBe(200);
  });

  it("raw prisma.strategyConfig.create() fails on the second call — protects the singleton", async () => {
    // This test documents WHY callers must go through the helpers: the
    // DB-level primary key constraint enforces single-row semantics, so a
    // stray second create() cannot silently add another row.
    await prisma.strategyConfig.create({ data: {} });
    await expect(prisma.strategyConfig.create({ data: {} })).rejects.toThrow();
    expect(await prisma.strategyConfig.count()).toBe(1);
  });
});
