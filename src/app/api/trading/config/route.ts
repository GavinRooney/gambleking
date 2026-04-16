// Strategy config API.
//
//   GET    /api/trading/config — current singleton row (auto-created if missing)
//   PUT    /api/trading/config — partial update
//   DELETE /api/trading/config — reset to DB defaults
//
// All access goes through the strategy-config helpers so the singleton
// invariant is enforced in one place.

import { NextRequest, NextResponse } from "next/server";
import {
  getStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
} from "@/lib/trading/strategy-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The set of fields the UI is allowed to update. Keep in sync with
// StrategyConfig in schema.prisma minus `id` / `updatedAt`.
const NUMERIC_FIELDS = [
  "scalpStake",
  "stopLossTicks",
  "preRaceExitSeconds",
  "preRaceWarningSeconds",
  "minMarketVolume",
  "maxConcurrentTrades",
  "dailyLossLimit",
  "maxStakePerTrade",
  "maxLayLiability",
] as const;

type ConfigField = (typeof NUMERIC_FIELDS)[number];

// Which fields must be integers (vs arbitrary floats).
const INTEGER_FIELDS: ReadonlySet<ConfigField> = new Set([
  "stopLossTicks",
  "preRaceExitSeconds",
  "preRaceWarningSeconds",
  "maxConcurrentTrades",
]);

function serialize(cfg: Awaited<ReturnType<typeof getStrategyConfig>>) {
  return {
    scalpStake: cfg.scalpStake,
    stopLossTicks: cfg.stopLossTicks,
    preRaceExitSeconds: cfg.preRaceExitSeconds,
    preRaceWarningSeconds: cfg.preRaceWarningSeconds,
    minMarketVolume: cfg.minMarketVolume,
    maxConcurrentTrades: cfg.maxConcurrentTrades,
    dailyLossLimit: cfg.dailyLossLimit,
    maxStakePerTrade: cfg.maxStakePerTrade,
    maxLayLiability: cfg.maxLayLiability,
    updatedAt: cfg.updatedAt.toISOString(),
  };
}

function validatePatch(
  raw: unknown
): { ok: true; patch: Partial<Record<ConfigField, number>> } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  const patch: Partial<Record<ConfigField, number>> = {};
  for (const field of NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${field} must be a finite number` };
    }
    if (v <= 0) {
      return { ok: false, error: `${field} must be positive` };
    }
    if (INTEGER_FIELDS.has(field) && !Number.isInteger(v)) {
      return { ok: false, error: `${field} must be an integer` };
    }
    patch[field] = v;
  }
  // Coherence check: warning must be >= hard-exit (you can't trigger the
  // hard exit before the warning). Applied only if both sides are present
  // in the patch OR can be paired with existing values — simplest to enforce
  // by checking both provided values when both are supplied.
  if (
    typeof patch.preRaceWarningSeconds === "number" &&
    typeof patch.preRaceExitSeconds === "number" &&
    patch.preRaceWarningSeconds < patch.preRaceExitSeconds
  ) {
    return {
      ok: false,
      error: "preRaceWarningSeconds must be >= preRaceExitSeconds",
    };
  }
  return { ok: true, patch };
}

export async function GET() {
  try {
    const cfg = await getStrategyConfig();
    return NextResponse.json(serialize(cfg));
  } catch (err) {
    console.error("[api/trading/config] GET error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => ({}));
    const v = validatePatch(raw);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    // Additional coherence check against current DB state: if the patch only
    // includes one of the two pre-race windows, pair it against the stored
    // value.
    if (
      (typeof v.patch.preRaceWarningSeconds === "number") !==
      (typeof v.patch.preRaceExitSeconds === "number")
    ) {
      const current = await getStrategyConfig();
      const warning = v.patch.preRaceWarningSeconds ?? current.preRaceWarningSeconds;
      const hard = v.patch.preRaceExitSeconds ?? current.preRaceExitSeconds;
      if (warning < hard) {
        return NextResponse.json(
          { error: "preRaceWarningSeconds must be >= preRaceExitSeconds" },
          { status: 400 }
        );
      }
    }

    const updated = await updateStrategyConfig(v.patch);
    return NextResponse.json(serialize(updated));
  } catch (err) {
    console.error("[api/trading/config] PUT error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const reset = await resetStrategyConfig();
    return NextResponse.json(serialize(reset));
  } catch (err) {
    console.error("[api/trading/config] DELETE error", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
