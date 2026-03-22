"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface BetData {
  id: string;
  stake: number;
  oddsTaken: number;
  betType: string;
  outcome: string;
  profitLoss: number | null;
  notes: string | null;
  createdAt: string;
  runner: {
    horse: { name: string; id: string };
    race: {
      id: string;
      raceName: string;
      date: string;
      course: { name: string };
    };
  };
}

interface BetsResponse {
  bets: BetData[];
  stats: {
    totalBets: number;
    totalStaked: number;
    totalProfitLoss: number;
    pendingCount: number;
    wonCount: number;
    lostCount: number;
  };
}

export default function BetsPage() {
  const [data, setData] = useState<BetsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/bets");
        if (res.ok) setData(await res.json());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  const stats = data?.stats;
  const bets = data?.bets ?? [];

  const roi =
    stats && stats.totalStaked > 0
      ? (stats.totalProfitLoss / stats.totalStaked) * 100
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Bet Tracker</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{stats?.totalBets ?? 0}</div>
            <p className="text-xs text-muted-foreground">Total Bets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">
              {stats?.totalStaked.toFixed(2) ?? "0.00"}
            </div>
            <p className="text-xs text-muted-foreground">Total Staked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div
              className={`text-2xl font-bold ${
                (stats?.totalProfitLoss ?? 0) >= 0
                  ? "text-green-500"
                  : "text-red-500"
              }`}
            >
              {(stats?.totalProfitLoss ?? 0) >= 0 ? "+" : ""}
              {stats?.totalProfitLoss.toFixed(2) ?? "0.00"}
            </div>
            <p className="text-xs text-muted-foreground">P&L</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">
              {stats && stats.wonCount + stats.lostCount > 0
                ? (
                    (stats.wonCount / (stats.wonCount + stats.lostCount)) *
                    100
                  ).toFixed(0)
                : 0}
              %
            </div>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div
              className={`text-2xl font-bold ${roi >= 0 ? "text-green-500" : "text-red-500"}`}
            >
              {roi >= 0 ? "+" : ""}
              {roi.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">ROI</p>
          </CardContent>
        </Card>
      </div>

      {/* Bet list */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({bets.length})</TabsTrigger>
          <TabsTrigger value="pending">
            Pending ({stats?.pendingCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="won">Won ({stats?.wonCount ?? 0})</TabsTrigger>
          <TabsTrigger value="lost">Lost ({stats?.lostCount ?? 0})</TabsTrigger>
        </TabsList>

        {["all", "pending", "won", "lost"].map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-2">
            {bets
              .filter((b) => tab === "all" || b.outcome === tab)
              .map((bet) => (
                <Card key={bet.id}>
                  <CardContent className="flex items-center gap-4 py-3">
                    <Badge
                      className={
                        bet.outcome === "won"
                          ? "bg-green-600"
                          : bet.outcome === "lost"
                            ? "bg-red-600"
                            : ""
                      }
                    >
                      {bet.outcome}
                    </Badge>
                    <div className="flex-1">
                      <Link
                        href={`/horses/${bet.runner.horse.id}`}
                        className="font-medium hover:underline"
                      >
                        {bet.runner.horse.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {bet.runner.race.course.name} &middot;{" "}
                        {bet.runner.race.raceName} &middot;{" "}
                        {new Date(bet.runner.race.date).toLocaleDateString(
                          "en-GB"
                        )}
                      </div>
                      {bet.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">
                          {bet.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <div>
                        <span className="text-muted-foreground">
                          {bet.betType === "each_way" ? "E/W" : "Win"}
                        </span>{" "}
                        <span className="font-medium tabular-nums">
                          {bet.stake.toFixed(2)} @ {bet.oddsTaken.toFixed(2)}
                        </span>
                      </div>
                      {bet.profitLoss !== null && (
                        <div
                          className={`font-bold tabular-nums ${
                            bet.profitLoss >= 0
                              ? "text-green-500"
                              : "text-red-500"
                          }`}
                        >
                          {bet.profitLoss >= 0 ? "+" : ""}
                          {bet.profitLoss.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
