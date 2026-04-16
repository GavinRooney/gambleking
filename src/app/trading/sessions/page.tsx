"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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
import { Activity, ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Session = {
  id: string;
  mode: "mock" | "practice" | "live";
  date: string;
  startedAt: string;
  endedAt: string | null;
  suspendedAt: string | null;
  durationMs: number;
  dailyPnL: number;
  tradesOpened: number;
  tradesClosed: number;
  active: boolean;
};

const MODE_STYLES: Record<Session["mode"], string> = {
  mock: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  practice: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  live: "bg-red-500/20 text-red-400 border-red-500/40",
};

export default function SessionsHistoryPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trading/sessions");
      if (!res.ok) throw new Error(await res.text());
      setSessions(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when a session starts, stops, or updates stats.
  useEffect(() => {
    const src = new EventSource("/api/trading/stream");
    const onUpdate = () => load();
    src.addEventListener("session:update", onUpdate);
    return () => {
      src.removeEventListener("session:update", onUpdate);
      src.close();
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <Link
        href="/trading"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sessions history</h1>
        <p className="text-sm text-muted-foreground">
          Every trading session the engine has run, newest first.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Sessions
            {sessions && (
              <Badge variant="secondary" className="ml-2 font-mono">
                {sessions.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!sessions ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions yet. Start one from the trading dashboard.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Closed</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("font-mono text-xs", MODE_STYLES[s.mode])}
                        >
                          {s.mode.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SessionStatus session={s} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {new Date(s.startedAt).toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.endedAt ? new Date(s.endedAt).toLocaleString("en-GB") : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatDuration(s.durationMs)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {s.tradesOpened}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {s.tradesClosed}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono", pnlColor(s.dailyPnL))}>
                        <span className="inline-flex items-center gap-1">
                          {s.dailyPnL > 0 && <TrendingUp className="h-3 w-3" />}
                          {s.dailyPnL < 0 && <TrendingDown className="h-3 w-3" />}
                          £{s.dailyPnL.toFixed(2)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SessionStatus({ session }: { session: Session }) {
  if (session.active) {
    return (
      <Badge variant="outline" className="gap-1 border-green-500/40 bg-green-500/10 text-green-400">
        <Activity className="h-3 w-3 animate-pulse" />
        Active
      </Badge>
    );
  }
  if (session.suspendedAt) {
    return (
      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">
        Suspended
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Ended
    </Badge>
  );
}

function pnlColor(v: number): string {
  if (v > 0) return "text-green-500";
  if (v < 0) return "text-red-500";
  return "";
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
