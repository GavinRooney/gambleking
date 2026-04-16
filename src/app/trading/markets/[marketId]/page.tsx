"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type MarketDetail = {
  id: string;
  betfairMarketId: string;
  name: string;
  startTime: string;
  status: "scanning" | "trading" | "warned" | "exited" | "closed";
  totalMatched: number;
  numRunners: number;
  runners: Array<{
    id: string;
    selectionId: number;
    horseName: string;
    bestBack: number | null;
    bestLay: number | null;
    traded: number;
    volatilityScore: number | null;
    bookBalance: number | null;
  }>;
  trades: Array<{
    id: string;
    status: string;
    runnerName: string;
    runnerId: string;
    stake: number;
    entryBackPrice: number;
    entryLayPrice: number;
    profitLoss: number;
    exitReason: string | null;
    mode: string;
    openedAt: string;
    closedAt: string | null;
    orders: Array<{
      id: string;
      side: string;
      purpose: string;
      price: number;
      size: number;
      matchedSize: number;
      status: string;
    }>;
  }>;
};

const STATUS_STYLES: Record<MarketDetail["status"], string> = {
  scanning: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  trading: "bg-green-500/20 text-green-400 border-green-500/40",
  warned: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  exited: "bg-red-500/20 text-red-400 border-red-500/40",
  closed: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = use(params);
  const [data, setData] = useState<MarketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/markets/${marketId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 1 Hz countdown clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Live updates come from the SSE stream; market:update events are
  // filtered to this page's market so we don't refetch on unrelated ticks.
  // A 10 s fallback poll catches any state we miss (e.g. trade status
  // transitions that don't emit market:update).
  useEffect(() => {
    const src = new EventSource("/api/trading/stream");

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refresh(), 200);
    };

    const onMarketUpdate = (e: MessageEvent) => {
      const p = JSON.parse(e.data);
      if (p.marketId === marketId) scheduleRefresh();
    };
    const onTrade = (e: MessageEvent) => {
      const p = JSON.parse(e.data);
      if (p.marketId === marketId) scheduleRefresh();
    };
    const onSession = () => scheduleRefresh();

    src.addEventListener("market:update", onMarketUpdate);
    src.addEventListener("trade:open", onTrade);
    src.addEventListener("trade:close", onTrade);
    src.addEventListener("session:update", onSession);

    const fallback = setInterval(refresh, 10_000);
    return () => {
      src.removeEventListener("market:update", onMarketUpdate);
      src.removeEventListener("trade:open", onTrade);
      src.removeEventListener("trade:close", onTrade);
      src.removeEventListener("session:update", onSession);
      src.close();
      if (debounce) clearTimeout(debounce);
      clearInterval(fallback);
    };
  }, [refresh, marketId]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const startMs = new Date(data.startTime).getTime();
  const msToStart = startMs - now;
  const countdown = formatCountdown(msToStart);
  const openTrades = data.trades.filter((t) => t.status === "open");
  const closedTrades = data.trades.filter((t) => t.status !== "open");

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{data.betfairMarketId}</span>
            <span>•</span>
            <span>{data.numRunners} runners</span>
            <span>•</span>
            <span>£{Math.round(data.totalMatched).toLocaleString()} matched</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={cn("px-2 py-1 font-mono", STATUS_STYLES[data.status])}>
            {data.status.toUpperCase()}
          </Badge>
          <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm">
            <Clock className="h-4 w-4" />
            <span className={cn("font-mono", msToStart < 60_000 && "text-orange-400", msToStart < 10_000 && "text-red-400")}>
              {countdown}
            </span>
          </div>
        </div>
      </div>

      {/* Runners */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runners</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50%]">Horse</TableHead>
                <TableHead className="text-right">Best back</TableHead>
                <TableHead className="text-right">Best lay</TableHead>
                <TableHead className="text-right">Volatility</TableHead>
                <TableHead className="text-right">Book bal.</TableHead>
                <TableHead className="text-right">Traded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runners.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium">{r.horseName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      #{r.selectionId}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.bestBack != null ? r.bestBack.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.bestLay != null ? r.bestLay.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.volatilityScore != null ? r.volatilityScore.toFixed(4) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.bookBalance != null ? r.bookBalance.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    £{Math.round(r.traded).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Open trades */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Open trades
            <Badge variant="secondary" className="font-mono">
              {openTrades.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open trades on this market.</p>
          ) : (
            <TradeTable trades={openTrades} />
          )}
        </CardContent>
      </Card>

      {/* Closed trades (most recent) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {closedTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed trades yet.</p>
          ) : (
            <TradeTable trades={closedTrades} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/trading" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Link>
  );
}

function TradeTable({ trades }: { trades: MarketDetail["trades"] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Horse</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Stake</TableHead>
            <TableHead className="text-right">Back @</TableHead>
            <TableHead className="text-right">Lay @</TableHead>
            <TableHead className="text-right">P&L</TableHead>
            <TableHead>Exit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.runnerName}</TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono text-xs">
                  {t.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">£{t.stake.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">{t.entryBackPrice.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">{t.entryLayPrice.toFixed(2)}</TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono",
                  t.profitLoss > 0 && "text-green-500",
                  t.profitLoss < 0 && "text-red-500"
                )}
              >
                £{t.profitLoss.toFixed(2)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t.exitReason ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCountdown(msToStart: number): string {
  if (msToStart <= 0) {
    const elapsed = Math.floor(-msToStart / 1000);
    return `+${formatHMS(elapsed)}`;
  }
  return `-${formatHMS(Math.floor(msToStart / 1000))}`;
}

function formatHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
