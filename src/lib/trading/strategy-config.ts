// StrategyConfig accessors.
//
// The StrategyConfig model is a single-row table (see note in schema.prisma).
// This module is the only place that talks to `prisma.strategyConfig.*` —
// every other callsite MUST go through these helpers so the upsert pattern is
// consistent and the singleton invariant can never be violated by a stray
// raw .create() call.
//
// On first access, a row with DB defaults is lazily created. Subsequent reads
// return that row; writes merge fields via upsert.

import { prisma } from "@/lib/db";
import type { StrategyConfig } from "@/generated/prisma/client";

// The fixed singleton primary key. Must match the @default in schema.prisma.
export const STRATEGY_CONFIG_ID = "singleton" as const;

type StrategyConfigUpdate = Partial<
  Omit<StrategyConfig, "id" | "updatedAt">
>;

// Fetch the singleton row, creating it with defaults on first access. Always
// returns a populated object.
export async function getStrategyConfig(): Promise<StrategyConfig> {
  return prisma.strategyConfig.upsert({
    where: { id: STRATEGY_CONFIG_ID },
    create: { id: STRATEGY_CONFIG_ID },
    update: {},
  });
}

// Apply a partial update to the singleton row. Returns the updated row.
export async function updateStrategyConfig(
  patch: StrategyConfigUpdate
): Promise<StrategyConfig> {
  return prisma.strategyConfig.upsert({
    where: { id: STRATEGY_CONFIG_ID },
    create: { id: STRATEGY_CONFIG_ID, ...patch },
    update: patch,
  });
}

// Reset the singleton back to its DB defaults. Returns the reset row.
// Primarily useful for tests and an admin "restore defaults" action.
export async function resetStrategyConfig(): Promise<StrategyConfig> {
  await prisma.strategyConfig.deleteMany({ where: { id: STRATEGY_CONFIG_ID } });
  return getStrategyConfig();
}
