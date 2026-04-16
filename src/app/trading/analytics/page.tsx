"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "mock" | "practice" | "live" | "all";
type Range = "1h" | "24h" | "7d" | "30d" | "all";

type Analytics = {
  mode: Mode;
  range: Range;
  since: string | null;
  kpis: {
    totalTrades: number;
    totalPnL: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number;
    profitCount: number;
    lossCount: number;
    scratchCount: number;
  };
  cumulativePnL: Array<{ at: string; pnl: number; tradeId: string }>;
  exitReasons: Array<{ reason: string; count: number; totalPnL: number; avgPnL: number }>;
  bestMarkets: Array<{ id: string; name: string; trades: number; totalPnL: number }>;
  worstMarkets: Array<{ id: string; name: string; trades: number; totalPnL: number }>;
};

const MODES: Mode[] = ["mock", "practice", "live", "all"];
const RANGES: Array<{ value: Range; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export default function AnalyticsPage() {
  const [mode, setMode] = useState<Mode>("mock");
  const [range, setRange] = useState<Range>("all");
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (m: Mode, r: Range) => {
    try {
      const res = await fetch(`/api/trading/analytics?mode=${m}&range=${r}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load(mode, range);
  }, [mode, range, load]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.cumulativePnL.map((p) => ({
      t: new Date(p.at).getTime(),
      pnl: +p.pnl.toFixed(2),
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            P&L, win rate, and exit-reason breakdown for closed trades.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border p-1">
            {MODES.map((m) => (
              <Button
                key={m}
                variant={mode === m ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode(m)}
                className="font-mono text-xs"
              >
                {m.toUpperCase()}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border p-1">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                variant={range === r.value ? "default" : "ghost"}
                size="sm"
                onClick={() => setRange(r.value)}
                className="font-mono text-xs"
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.kpis.totalTrades === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No closed trades in the last{" "}
            <span className="font-mono">{range === "all" ? "(all time)" : range}</span>{" "}
            for <span className="font-mono">{mode.toUpperCase()}</span>.
            Start a session and let some trades settle, or widen the range.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Total P&L" value={<Money value={data.kpis.totalPnL} />} />
            <Kpi label="Trades closed" value={data.kpis.totalTrades.toLocaleString()} />
            <Kpi
              label="Win rate"
              value={`${(data.kpis.winRate * 100).toFixed(1)}%`}
              hint={`${data.kpis.profitCount}W · ${data.kpis.lossCount}L · ${data.kpis.scratchCount} scratch`}
            />
            <Kpi
              label="Expectancy / trade"
              value={<Money value={data.kpis.expectancy} />}
              hint={`avg win £${data.kpis.avgWin.toFixed(2)} · avg loss £${data.kpis.avgLoss.toFixed(2)}`}
            />
          </div>

          {/* Cumulative P&L chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cumulative P&L over time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: 12, right: 12, top: 8 }}>
                    <defs>
                      <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) => new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      className="text-xs"
                    />
                    <YAxis
                      className="text-xs"
                      tickFormatter={(v) => `£${v}`}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(v) => new Date(v as number).toLocaleString("en-GB")}
                      formatter={(v) => [`£${Number(v).toFixed(2)}`, "P&L"]}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="currentColor"
                      strokeWidth={2}
                      className={cn(
                        data.kpis.totalPnL > 0 ? "text-green-500" : data.kpis.totalPnL < 0 ? "text-red-500" : "text-foreground"
                      )}
                      fill="url(#pnlFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Exit reason breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exit reason breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Total P&L</TableHead>
                    <TableHead className="text-right">Avg P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.exitReasons.map((r) => (
                    <TableRow key={r.reason}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {r.reason}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.count}</TableCell>
                      <TableCell className={cn("text-right font-mono", pnlColor(r.totalPnL))}>
                        <Money value={r.totalPnL} />
                      </TableCell>
                      <TableCell className={cn("text-right font-mono", pnlColor(r.avgPnL))}>
                        <Money value={r.avgPnL} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Best / worst markets */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Best markets</CardTitle>
                <p className="text-xs text-muted-foreground">Top 5 by total P&L (≥ 2 trades)</p>
              </CardHeader>
              <CardContent>
                <MarketTable rows={data.bestMarkets} emptyHint="Not enough trades yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Worst markets</CardTitle>
                <p className="text-xs text-muted-foreground">Bottom 5 by total P&L (≥ 2 trades)</p>
              </CardHeader>
              <CardContent>
                <MarketTable rows={data.worstMarkets} emptyHint="Not enough trades yet." />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
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

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Money({ value }: { value: number }) {
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span className={cn("inline-flex items-center gap-1", pnlColor(value))}>
      {positive && <TrendingUp className="h-4 w-4" />}
      {negative && <TrendingDown className="h-4 w-4" />}
      £{value.toFixed(2)}
    </span>
  );
}

function pnlColor(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "";
}

function MarketTable({
  rows,
  emptyHint,
}: {
  rows: Array<{ id: string; name: string; trades: number; totalPnL: number }>;
  emptyHint: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead className="text-right">Trades</TableHead>
          <TableHead className="text-right">P&L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link
                href={`/trading/markets/${r.id}`}
                className="font-medium hover:underline"
              >
                {r.name}
              </Link>
            </TableCell>
            <TableCell className="text-right font-mono">{r.trades}</TableCell>
            <TableCell className={cn("text-right font-mono", pnlColor(r.totalPnL))}>
              <Money value={r.totalPnL} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
