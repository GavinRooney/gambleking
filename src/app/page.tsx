"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RaceCard } from "@/components/race-card";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { Trophy, TrendingUp, Wallet, Star } from "lucide-react";
import Link from "next/link";

interface RaceData {
  id: string;
  raceName: string;
  raceType: string;
  date: string;
  distanceFurlongs: number;
  going: string | null;
  class: number | null;
  prizeMoney: number | null;
  numRunners: number | null;
  course: { name: string; country: string };
  runners: {
    id: string;
    gamblekingScore: number | null;
    confidenceLevel: string | null;
    horse: { name: string };
  }[];
}

interface BestBetData {
  race: RaceData;
  topRunner: {
    horse: { name: string; id: string };
    gamblekingScore: number | null;
    confidenceLevel: string | null;
  };
  scoreGap: number;
}

interface StatsData {
  betting: {
    totalBets: number;
    totalProfitLoss: number;
    winRate: number;
  };
  predictions: {
    accuracy: number;
  };
}

export default function DashboardPage() {
  const [races, setRaces] = useState<RaceData[]>([]);
  const [bestBets, setBestBets] = useState<BestBetData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [racesRes, betsRes, statsRes] = await Promise.all([
          fetch("/api/races"),
          fetch("/api/best-bets"),
          fetch("/api/stats"),
        ]);

        if (racesRes.ok) setRaces(await racesRes.json());
        if (betsRes.ok) setBestBets(await betsRes.json());
        if (statsRes.ok) setStats(await statsRes.json());
      } catch {
        // API may not be available yet
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const meetings = new Map<string, RaceData[]>();
  for (const race of races) {
    const key = race.course.name;
    meetings.set(key, [...(meetings.get(key) ?? []), race]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          {format(new Date(), "EEEE d MMMM yyyy")}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Meetings</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{meetings.size}</div>
            <p className="text-xs text-muted-foreground">
              {races.length} races
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Best Bets</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bestBets.length}</div>
            <p className="text-xs text-muted-foreground">
              high confidence picks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">P&L</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.betting.totalProfitLoss !== undefined
                ? `${stats.betting.totalProfitLoss >= 0 ? "+" : ""}${stats.betting.totalProfitLoss.toFixed(2)}`
                : "--"}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.betting.totalBets ?? 0} bets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Accuracy</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.predictions.accuracy !== undefined
                ? `${stats.predictions.accuracy.toFixed(1)}%`
                : "--"}
            </div>
            <p className="text-xs text-muted-foreground">prediction rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Best bets */}
      {bestBets.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Today&apos;s Best Bets</h2>
            <Link
              href="/best-bets"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bestBets.slice(0, 3).map((bb) => (
              <Card key={bb.race.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      {bb.race.course.name}
                    </CardTitle>
                    <ConfidenceBadge level={bb.topRunner.confidenceLevel} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {bb.race.raceName}
                  </p>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/horses/${bb.topRunner.horse.id}`}
                    className="font-semibold hover:underline"
                  >
                    {bb.topRunner.horse.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <span className="font-bold tabular-nums">
                      Score: {bb.topRunner.gamblekingScore?.toFixed(0)}
                    </span>
                    <span className="text-muted-foreground">
                      (gap: +{bb.scoreGap.toFixed(0)})
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Today's meetings */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {loading ? "Loading races..." : "Today's Meetings"}
        </h2>
        {!loading && meetings.size === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No races found for today. Use the Admin page to sync race cards.
            </CardContent>
          </Card>
        )}
        {Array.from(meetings.entries()).map(([course, courseRaces]) => (
          <div key={course} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
              {course} ({courseRaces.length} races)
            </h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {courseRaces.map((race) => (
                <RaceCard key={race.id} race={race} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
