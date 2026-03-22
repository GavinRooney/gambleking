"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RaceCard } from "@/components/race-card";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

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

function RacesContent() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");

  const [date, setDate] = useState(
    dateParam || new Date().toISOString().split("T")[0]
  );
  const [races, setRaces] = useState<RaceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadRaces = async () => {
    setLoading(true);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/races?date=${date}`);
      if (res.ok) setRaces(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Only today and tomorrow can be fetched on Basic plan
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];
  const canSync = date === today || date === tomorrow;

  const syncAndScore = async () => {
    if (!canSync) {
      setSyncMsg("Only today and tomorrow are available on the Basic API plan.");
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const syncRes = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok) {
        setSyncMsg(syncData.message || "Sync failed");
        return;
      }
      // Score them
      await fetch("/api/scores/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      setSyncMsg(`Synced ${syncData.races} races, ${syncData.runners} runners`);
      await loadRaces();
    } catch {
      setSyncMsg("Sync failed — check console");
    } finally {
      setSyncing(false);
    }
  };

  const shiftDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split("T")[0]);
  };

  const meetings = new Map<string, RaceData[]>();
  for (const race of races) {
    const key = race.course.name;
    meetings.set(key, [...(meetings.get(key) ?? []), race]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Race Day</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={syncAndScore}
            disabled={syncing || !canSync}
            title={canSync ? "Fetch races from API" : "Only today/tomorrow available"}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Fetch"}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-muted-foreground">Loading races...</p>
      )}

      {syncMsg && (
        <p className="text-sm text-muted-foreground">{syncMsg}</p>
      )}

      {!loading && meetings.size === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-3">
              No races found for{" "}
              {new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              .
            </p>
            {canSync ? (
              <Button onClick={syncAndScore} disabled={syncing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Fetching races..." : "Fetch races for this date"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Only today and tomorrow are available on the Basic API plan.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {Array.from(meetings.entries()).map(([course, courseRaces]) => (
        <div key={course}>
          <h2 className="mb-3 text-lg font-semibold">
            {course}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({courseRaces.length} races)
            </span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {courseRaces.map((race) => (
              <RaceCard key={race.id} race={race} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RacesPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
      <RacesContent />
    </Suspense>
  );
}
