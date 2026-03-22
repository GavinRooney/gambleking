"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface StatsData {
  trainers: {
    id: string;
    name: string;
    flatWins: number;
    hurdleWins: number;
    strikeRate14d: number | null;
    strikeRate30d: number | null;
  }[];
  jockeys: {
    id: string;
    name: string;
    flatWins: number;
    hurdleWins: number;
    strikeRate14d: number | null;
    strikeRate30d: number | null;
  }[];
  betting: {
    totalBets: number;
    totalStaked: number;
    totalProfitLoss: number;
    winRate: number;
  };
  predictions: {
    totalRaces: number;
    racesWithResults: number;
    correctPredictions: number;
    accuracy: number;
  };
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/stats");
        if (res.ok) setStats(await res.json());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!stats) return <p className="text-destructive">Failed to load stats</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Statistics</h1>

      {/* Prediction accuracy */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Prediction Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.predictions.accuracy.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.predictions.correctPredictions}/
              {stats.predictions.racesWithResults} correct (top-rated =
              winner)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Betting P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                stats.betting.totalProfitLoss >= 0
                  ? "text-green-500"
                  : "text-red-500"
              }`}
            >
              {stats.betting.totalProfitLoss >= 0 ? "+" : ""}
              {stats.betting.totalProfitLoss.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.betting.totalBets} bets, {stats.betting.winRate.toFixed(0)}
              % win rate
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Races Scored</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.predictions.totalRaces}
            </div>
            <p className="text-xs text-muted-foreground">total races in database</p>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboards */}
      <Tabs defaultValue="trainers">
        <TabsList>
          <TabsTrigger value="trainers">Trainers</TabsTrigger>
          <TabsTrigger value="jockeys">Jockeys</TabsTrigger>
        </TabsList>

        <TabsContent value="trainers">
          <Card>
            <CardHeader>
              <CardTitle>Top Trainers (14-day strike rate)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">14d SR</TableHead>
                    <TableHead className="text-right">30d SR</TableHead>
                    <TableHead className="text-right">Flat Wins</TableHead>
                    <TableHead className="text-right">Hurdle Wins</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.trainers.map((t, i) => (
                    <TableRow key={t.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.strikeRate14d?.toFixed(1) ?? "-"}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.strikeRate30d?.toFixed(1) ?? "-"}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.flatWins}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.hurdleWins}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jockeys">
          <Card>
            <CardHeader>
              <CardTitle>Top Jockeys (14-day strike rate)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">14d SR</TableHead>
                    <TableHead className="text-right">30d SR</TableHead>
                    <TableHead className="text-right">Flat Wins</TableHead>
                    <TableHead className="text-right">Hurdle Wins</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.jockeys.map((j, i) => (
                    <TableRow key={j.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{j.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.strikeRate14d?.toFixed(1) ?? "-"}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.strikeRate30d?.toFixed(1) ?? "-"}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.flatWins}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.hurdleWins}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
