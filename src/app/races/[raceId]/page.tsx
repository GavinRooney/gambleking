"use client";

import { useEffect, useState, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RunnerRow } from "@/components/runner-row";
import { BetForm } from "@/components/bet-form";
import { MapPin, Clock, Users, ExternalLink } from "lucide-react";

interface RaceDetail {
  id: string;
  raceName: string;
  raceType: string;
  date: string;
  distanceFurlongs: number;
  going: string | null;
  class: number | null;
  prizeMoney: number | null;
  numRunners: number | null;
  weatherForecast: string | null;
  replayUrl: string | null;
  course: { name: string; country: string; surface: string | null };
  runners: RunnerData[];
}

interface RunnerData {
  id: string;
  drawPosition: number | null;
  weightCarried: string | null;
  officialRating: number | null;
  oddsSp: number | null;
  oddsBest: number | null;
  gamblekingScore: number | null;
  confidenceLevel: string | null;
  finishPosition: number | null;
  horse: {
    id: string;
    name: string;
    age: number | null;
    sex: string | null;
    raceComments: { comment: string; raceDate: string; course: string; source?: string }[];
  };
  jockey: { name: string } | null;
  trainer: { name: string } | null;
}

function formatDistance(furlongs: number): string {
  const miles = Math.floor(furlongs / 8);
  const remaining = furlongs % 8;
  if (miles === 0) return `${furlongs}f`;
  if (remaining === 0) return `${miles}m`;
  return `${miles}m${remaining}f`;
}

export default function RaceDetailPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = use(params);
  const [race, setRace] = useState<RaceDetail | null>(null);
  const [selectedRunner, setSelectedRunner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRace = async () => {
    try {
      const res = await fetch(`/api/races/${raceId}`);
      if (res.ok) setRace(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  if (loading) return <p className="text-muted-foreground">Loading race...</p>;
  if (!race) return <p className="text-destructive">Race not found</p>;

  const hasResults = race.runners.some((r) => r.finishPosition !== null);

  return (
    <div className="space-y-6">
      {/* Race header */}
      <div>
        <h1 className="text-2xl font-bold">{race.raceName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {race.course.name} ({race.course.country})
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(race.date).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <Badge variant="outline">{race.raceType}</Badge>
          <span>{formatDistance(race.distanceFurlongs)}</span>
          {race.going && <span>{race.going}</span>}
          {race.class && <span>Class {race.class}</span>}
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {race.numRunners ?? race.runners.length} runners
          </span>
          {race.prizeMoney && (
            <span>
              {new Intl.NumberFormat("en-GB", {
                style: "currency",
                currency: "GBP",
                maximumFractionDigits: 0,
              }).format(race.prizeMoney)}
            </span>
          )}
        </div>
        {race.weatherForecast && (
          <p className="mt-1 text-xs text-muted-foreground">
            Weather: {race.weatherForecast}
          </p>
        )}
        {race.replayUrl && (
          <a
            href={race.replayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Watch Replay
          </a>
        )}
      </div>

      {/* Runners */}
      <Card>
        <CardHeader>
          <CardTitle>
            {hasResults ? "Results" : "Runners"} (Ranked by GambleKing Score)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {race.runners.map((runner, i) => {
            const formComment = runner.horse.raceComments?.find(
              (c: { comment: string; source?: string }) => c.source === "form"
            );
            const recentForm: (number | null)[] = formComment
              ? formComment.comment
                  .replace(/[-/]/g, "")
                  .split("")
                  .map((ch: string) => {
                    const n = parseInt(ch, 10);
                    return isNaN(n) ? null : n;
                  })
              : [];

            return (
              <div key={runner.id}>
                <div
                  className="cursor-pointer"
                  onClick={() =>
                    setSelectedRunner(
                      selectedRunner === runner.id ? null : runner.id
                    )
                  }
                >
                  <RunnerRow
                    runner={runner}
                    rank={i + 1}
                    recentForm={recentForm}
                    showResult={hasResults}
                  />
                </div>

                {selectedRunner === runner.id && (
                  <div className="border-b bg-muted/30 px-4 py-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Recent comments */}
                      <div>
                        <h4 className="mb-2 text-sm font-medium">
                          Recent Race Comments
                        </h4>
                        {runner.horse.raceComments?.length > 0 ? (
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {runner.horse.raceComments.map((c, idx) => (
                              <li key={idx}>
                                <span className="font-medium">{c.course}</span>{" "}
                                ({new Date(c.raceDate).toLocaleDateString("en-GB")}
                                ): {c.comment}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No race comments available
                          </p>
                        )}
                      </div>

                      {/* Bet form */}
                      <div>
                        <BetForm
                          runnerId={runner.id}
                          horseName={runner.horse.name}
                          currentOdds={runner.oddsBest}
                          onSubmit={loadRace}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {i < race.runners.length - 1 && <Separator />}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
