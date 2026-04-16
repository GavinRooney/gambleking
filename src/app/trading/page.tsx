"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  BarChart3,
  ChevronRight,
  Eraser,
  History,
  Play,
  Settings,
  Square,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MarketSummary = {
  id: string;
  betfairMarketId: string;
  name: string;
  startTime: string;
  status: "scanning" | "trading" | "warned" | "exited" | "closed";
  totalMatched: number;
  numRunners: number;
  openTradeCount: number;
};

const MARKET_STATUS_STYLES: Record<MarketSummary["status"], string> = {
  scanning: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  trading: "bg-green-500/20 text-green-400 border-green-500/40",
  warned: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  exited: "bg-red-500/20 text-red-400 border-red-500/40",
  closed: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

type Mode = "mock" | "practice" | "live";

type SessionStatus = {
  mode: Mode;
  active: boolean;
  session: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    dailyPnL: number;
    tradesOpened: number;
    tradesClosed: number;
    mode: string;
  } | null;
  openTradeCount: number;
  trackedMarketCount: number;
};

type TradeFeedEntry = {
  kind: "open" | "close";
  tradeId: string;
  marketId: string;
  runnerId: string;
  stake?: number;
  entryPrice?: number;
  profitLoss?: number;
  exitReason?: string | null;
  at: number;
};

const MODE_STYLES: Record<Mode, { label: string; classes: string }> = {
  mock: { label: "MOCK", classes: "bg-slate-500 hover:bg-slate-500 text-white" },
  practice: {
    label: "PRACTICE",
    classes: "bg-orange-500 hover:bg-orange-500 text-white",
  },
  live: { label: "LIVE", classes: "bg-red-600 hover:bg-red-600 text-white" },
};

export default function TradingDashboardPage() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [feed, setFeed] = useState<TradeFeedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/trading/session");
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/trading/markets");
      if (!res.ok) return;
      setMarkets(await res.json());
    } catch {
      /* soft-fail — dashboard still usable */
    }
  }, []);

  // Initial load.
  useEffect(() => {
    refreshStatus();
    refreshMarkets();
  }, [refreshStatus, refreshMarkets]);

  // 1 Hz clock for countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Markets refresh on market:update SSE events; a slow fallback poll
  // (10s) catches brand-new markets that appear between ticks.
  useEffect(() => {
    const poll = setInterval(refreshMarkets, 10_000);
    return () => clearInterval(poll);
  }, [refreshMarkets]);

  // SSE: subscribe for the page's whole life. Re-fetch status on any session
  // event; append to the trade feed on open/close events.
  useEffect(() => {
    const src = new EventSource("/api/trading/stream");
    sourceRef.current = src;

    const onSessionUpdate = () => refreshStatus();

    // market:update fires once per market per tick (~10 events in a burst).
    // Debounce the refreshMarkets call so we fetch once per burst instead of
    // 10×.
    let marketRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onMarketUpdate = () => {
      if (marketRefreshTimer) clearTimeout(marketRefreshTimer);
      marketRefreshTimer = setTimeout(() => refreshMarkets(), 300);
    };

    const onTradeOpen = (e: MessageEvent) => {
      const p = JSON.parse(e.data);
      setFeed((prev) =>
        [
          {
            kind: "open" as const,
            tradeId: p.tradeId,
            marketId: p.marketId,
            runnerId: p.runnerId,
            stake: p.stake,
            entryPrice: p.entryPrice,
            at: p.at,
          },
          ...prev,
        ].slice(0, 50)
      );
    };
    const onTradeClose = (e: MessageEvent) => {
      const p = JSON.parse(e.data);
      setFeed((prev) =>
        [
          {
            kind: "close" as const,
            tradeId: p.tradeId,
            marketId: p.marketId,
            runnerId: p.runnerId,
            profitLoss: p.profitLoss,
            exitReason: p.exitReason,
            at: p.at,
          },
          ...prev,
        ].slice(0, 50)
      );
    };

    src.addEventListener("session:update", onSessionUpdate);
    src.addEventListener("market:update", onMarketUpdate);
    src.addEventListener("trade:open", onTradeOpen);
    src.addEventListener("trade:close", onTradeClose);

    src.onerror = () => {
      // EventSource auto-reconnects; surface a soft warning so the user
      // knows if the stream has dropped for longer than a blink.
      setError("Live stream disconnected — retrying…");
    };
    src.onopen = () => setError(null);

    return () => {
      src.removeEventListener("session:update", onSessionUpdate);
      src.removeEventListener("market:update", onMarketUpdate);
      src.removeEventListener("trade:open", onTradeOpen);
      src.removeEventListener("trade:close", onTradeClose);
      if (marketRefreshTimer) clearTimeout(marketRefreshTimer);
      src.close();
    };
  }, [refreshStatus, refreshMarkets]);

  const startSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trading/session", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start session");
      }
      setStatus(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetData = async () => {
    if (
      !confirm(
        "Wipe all trading data? This deletes every market, runner, trade, and session. Strategy config and predictor data are preserved."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trading/admin/reset", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to reset data");
      }
      setFeed([]);
      setMarkets([]);
      await refreshStatus();
      await refreshMarkets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stopSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trading/session", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to stop session");
      }
      setStatus(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mode = status?.mode ?? "mock";
  const modeStyle = MODE_STYLES[mode];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trading</h1>
          <p className="text-sm text-muted-foreground">
            Automated Betfair Exchange pre-race scalping (Phase 1 — Bet Angel bridge)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/trading/sessions"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <History className="h-4 w-4" />
            Sessions
          </Link>
          <Link
            href="/trading/analytics"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </Link>
          <Link
            href="/trading/config"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Settings className="h-4 w-4" />
            Config
          </Link>
          <Badge className={cn("px-3 py-1 font-mono text-xs", modeStyle.classes)}>
            {modeStyle.label}
          </Badge>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {status?.active ? (
              <Button variant="destructive" onClick={stopSession} disabled={busy}>
                <Square className="h-4 w-4" />
                Stop session
              </Button>
            ) : (
              <Button onClick={startSession} disabled={busy}>
                <Play className="h-4 w-4" />
                Start session
              </Button>
            )}
            <Button variant="outline" onClick={refreshStatus} disabled={busy}>
              Refresh
            </Button>
            <Button
              variant="ghost"
              onClick={resetData}
              disabled={busy || !!status?.active}
              title={status?.active ? "Stop session first" : "Wipe all trading data"}
            >
              <Eraser className="h-4 w-4" />
              Reset data
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat
              label="Status"
              value={
                status?.active ? (
                  <span className="flex items-center gap-1 text-green-500">
                    <Activity className="h-3.5 w-3.5 animate-pulse" />
                    Active
                  </span>
                ) : (
                  <span className="text-muted-foreground">Idle</span>
                )
              }
            />
            <Stat
              label="Daily P&L"
              value={
                status?.session ? (
                  <PnL value={status.session.dailyPnL} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
            <Stat
              label="Trades opened"
              value={<span>{status?.session?.tradesOpened ?? 0}</span>}
            />
            <Stat
              label="Trades closed"
              value={<span>{status?.session?.tradesClosed ?? 0}</span>}
            />
          </div>
        </CardContent>
      </Card>

      {/* Active markets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Active markets
            <Badge variant="secondary" className="ml-2 font-mono">
              {markets.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {markets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No markets tracked yet. Start a session to begin scanning.
            </p>
          ) : (
            <ul className="divide-y">
              {markets.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/trading/markets/${m.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-accent/40 px-1 -mx-1 rounded-md transition-colors"
                  >
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-xs shrink-0",
                          MARKET_STATUS_STYLES[m.status]
                        )}
                      >
                        {m.status.toUpperCase()}
                      </Badge>
                      <span className="font-medium truncate">{m.name}</span>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {formatMarketCountdown(new Date(m.startTime).getTime() - now)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span>{m.numRunners} runners</span>
                      {m.openTradeCount > 0 && (
                        <Badge variant="secondary" className="font-mono">
                          {m.openTradeCount} open
                        </Badge>
                      )}
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Trade feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live trade feed</CardTitle>
        </CardHeader>
        <CardContent>
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trades yet. Start a session to see activity.
            </p>
          ) : (
            <ul className="divide-y">
              {feed.map((entry, idx) => (
                <FeedRow key={`${entry.tradeId}-${entry.kind}-${idx}`} entry={entry} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatMarketCountdown(msToStart: number): string {
  const past = msToStart <= 0;
  const total = Math.floor(Math.abs(msToStart) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return past ? `+${body}` : `-${body}`;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function PnL({ value }: { value: number }) {
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span
      className={cn(
        "flex items-center gap-1",
        positive && "text-green-500",
        negative && "text-red-500"
      )}
    >
      {positive && <TrendingUp className="h-4 w-4" />}
      {negative && <TrendingDown className="h-4 w-4" />}
      £{value.toFixed(2)}
    </span>
  );
}

function FeedRow({ entry }: { entry: TradeFeedEntry }) {
  const time = useMemo(
    () => new Date(entry.at).toLocaleTimeString("en-GB"),
    [entry.at]
  );
  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <div className="flex items-center gap-3">
        <Badge variant={entry.kind === "open" ? "outline" : "secondary"}>
          {entry.kind === "open" ? "OPEN" : "CLOSE"}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">{time}</span>
        <span className="font-mono text-xs">{entry.tradeId.slice(-6)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {entry.kind === "open" && entry.stake != null && (
          <span className="text-muted-foreground">
            £{entry.stake} @ {entry.entryPrice?.toFixed(2)}
          </span>
        )}
        {entry.kind === "close" && entry.profitLoss != null && (
          <PnL value={entry.profitLoss} />
        )}
        {entry.kind === "close" && entry.exitReason && (
          <Badge variant="outline" className="font-mono">
            {entry.exitReason}
          </Badge>
        )}
      </div>
    </li>
  );
}
