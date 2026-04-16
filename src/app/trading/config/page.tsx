"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

type Config = {
  scalpStake: number;
  stopLossTicks: number;
  preRaceExitSeconds: number;
  preRaceWarningSeconds: number;
  minMarketVolume: number;
  maxConcurrentTrades: number;
  dailyLossLimit: number;
  maxStakePerTrade: number;
  maxLayLiability: number;
  updatedAt: string;
};

type FormValues = Omit<Config, "updatedAt">;

// Grouped so the UI reads top-down as a strategy trader would configure it.
const SECTIONS: Array<{
  title: string;
  blurb: string;
  fields: Array<{
    key: keyof FormValues;
    label: string;
    description: string;
    prefix?: string;
    suffix?: string;
    step: number;
    min: number;
  }>;
}> = [
  {
    title: "Stakes",
    blurb: "Nominal bet size per leg and the hard cap per order.",
    fields: [
      {
        key: "scalpStake",
        label: "Scalp stake",
        description: "Stake on each leg of a paired scalp trade.",
        prefix: "£",
        step: 1,
        min: 0.01,
      },
      {
        key: "maxStakePerTrade",
        label: "Max stake per trade",
        description: "Hard cap — any order above this is rejected before placement.",
        prefix: "£",
        step: 1,
        min: 0.01,
      },
    ],
  },
  {
    title: "Risk controls",
    blurb: "Stop-loss thickness and the daily circuit-breaker.",
    fields: [
      {
        key: "stopLossTicks",
        label: "Stop-loss (ticks)",
        description: "Adverse ticks before a single-legged position is flattened.",
        suffix: "ticks",
        step: 1,
        min: 1,
      },
      {
        key: "dailyLossLimit",
        label: "Daily loss limit",
        description: "Session suspends automatically once cumulative P&L reaches this loss.",
        prefix: "£",
        step: 10,
        min: 1,
      },
      {
        key: "maxConcurrentTrades",
        label: "Max concurrent trades per market",
        description: "OMS refuses new opens on a market already holding this many.",
        step: 1,
        min: 1,
      },
      {
        key: "maxLayLiability",
        label: "Max lay liability",
        description: "Hard cap on (layPrice − 1) × stake — rejects extreme-odds layings before placement.",
        prefix: "£",
        step: 50,
        min: 1,
      },
    ],
  },
  {
    title: "Pre-race timing",
    blurb: "Warning and hard-exit thresholds relative to race start.",
    fields: [
      {
        key: "preRaceWarningSeconds",
        label: "Warning window",
        description:
          "Seconds before start to stop opening new trades on the market (market → warned).",
        suffix: "seconds",
        step: 5,
        min: 1,
      },
      {
        key: "preRaceExitSeconds",
        label: "Hard exit",
        description:
          "Seconds before start to cancel unmatched and green up open positions (market → exited).",
        suffix: "seconds",
        step: 1,
        min: 1,
      },
    ],
  },
  {
    title: "Market filter",
    blurb: "Minimum liquidity required for a market to qualify.",
    fields: [
      {
        key: "minMarketVolume",
        label: "Min market volume",
        description: "Total matched volume below which a market is ignored by the scanner.",
        prefix: "£",
        step: 1_000,
        min: 0,
      },
    ],
  },
];

export default function StrategyConfigPage() {
  const [values, setValues] = useState<FormValues | null>(null);
  const [initial, setInitial] = useState<FormValues | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trading/config");
      if (!res.ok) throw new Error(await res.text());
      const cfg: Config = await res.json();
      const { updatedAt: ts, ...rest } = cfg;
      setValues(rest);
      setInitial(rest);
      setUpdatedAt(ts);
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useCallback(() => {
    if (!values || !initial) return false;
    return (Object.keys(values) as Array<keyof FormValues>).some(
      (k) => values[k] !== initial[k]
    );
  }, [values, initial]);

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trading/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const { updatedAt: ts, ...rest } = body as Config;
      setValues(rest);
      setInitial(rest);
      setUpdatedAt(ts);
      setMessage({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset strategy config to defaults? This takes effect on the next tick.")) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trading/config", { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const { updatedAt: ts, ...rest } = body as Config;
      setValues(rest);
      setInitial(rest);
      setUpdatedAt(ts);
      setMessage({ kind: "ok", text: "Reset to defaults." });
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!values) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">
          {message?.kind === "err" ? message.text : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Strategy configuration</h1>
          <p className="text-sm text-muted-foreground">
            PRD §8.3 parameters. Changes take effect on the next engine tick.
            {updatedAt && (
              <span className="ml-2 font-mono text-xs">
                Last saved: {new Date(updatedAt).toLocaleString("en-GB")}
              </span>
            )}
          </p>
        </div>
      </div>

      {message && (
        <Card
          className={cn(
            message.kind === "ok"
              ? "border-green-500/40 bg-green-500/10"
              : "border-destructive/50 bg-destructive/10"
          )}
        >
          <CardContent
            className={cn(
              "pt-6 text-sm",
              message.kind === "ok" ? "text-green-500" : "text-destructive"
            )}
          >
            {message.text}
          </CardContent>
        </Card>
      )}

      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="text-base">{section.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{section.blurb}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <p className="text-xs text-muted-foreground">{f.description}</p>
                <div className="flex items-center gap-2">
                  {f.prefix && (
                    <span className="text-sm text-muted-foreground">{f.prefix}</span>
                  )}
                  <Input
                    id={f.key}
                    type="number"
                    step={f.step}
                    min={f.min}
                    value={values[f.key]}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      setValues({ ...values, [f.key]: Number.isNaN(n) ? 0 : n });
                    }}
                    className="max-w-[180px] font-mono"
                  />
                  {f.suffix && (
                    <span className="text-sm text-muted-foreground">{f.suffix}</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || !dirty()}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !dirty()}
          onClick={() => setValues(initial)}
        >
          Discard changes
        </Button>
      </div>
    </form>
  );
}

function BackLink() {
  return (
    <Link
      href="/trading"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Link>
  );
}
