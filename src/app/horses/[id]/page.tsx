"use client";

import { useEffect, useState, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoingChart } from "@/components/going-chart";
import Link from "next/link";

interface HorseProfile {
  id: string;
  name: string;
  age: number | null;
  sex: string | null;
  sire: string | null;
  dam: string | null;
  owner: string | null;
  flatRating: number | null;
  hurdlesRating: number | null;
  trainer: { name: string } | null;
  goingPreferences: {
    going: string;
    runs: number;
    wins: number;
    places: number;
    winPct: number;
  }[];
  distancePreferences: {
    distanceBand: string;
    runs: number;
    wins: number;
    places: number;
    winPct: number;
  }[];
  courseForm: {
    runs: number;
    wins: number;
    places: number;
    winPct: number;
    course: { name: string };
  }[];
  raceComments: {
    raceDate: string;
    course: string;
    comment: string;
    source: string | null;
  }[];
  runners: {
    finishPosition: number | null;
    gamblekingScore: number | null;
    oddsSp: number | null;
    race: {
      id: string;
      raceName: string;
      date: string;
      raceType: string;
      going: string | null;
      distanceFurlongs: number;
      course: { name: string };
    };
    jockey: { name: string } | null;
  }[];
}

export default function HorseProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [horse, setHorse] = useState<HorseProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/horses/${id}`);
        if (res.ok) setHorse(await res.json());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!horse) return <p className="text-destructive">Horse not found</p>;

  const totalRuns = horse.runners.length;
  const totalWins = horse.runners.filter((r) => r.finishPosition === 1).length;
  const totalPlaces = horse.runners.filter(
    (r) => r.finishPosition !== null && r.finishPosition <= 3
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{horse.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {horse.age && <span>{horse.age}yo</span>}
          {horse.sex && <Badge variant="outline">{horse.sex}</Badge>}
          {horse.trainer && <span>Trainer: {horse.trainer.name}</span>}
          {horse.sire && <span>Sire: {horse.sire}</span>}
          {horse.dam && <span>Dam: {horse.dam}</span>}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{totalRuns}</div>
            <p className="text-xs text-muted-foreground">Runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{totalWins}</div>
            <p className="text-xs text-muted-foreground">Wins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{totalPlaces}</div>
            <p className="text-xs text-muted-foreground">Places</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">
              {totalRuns > 0 ? ((totalWins / totalRuns) * 100).toFixed(0) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">
              {horse.flatRating || horse.hurdlesRating || "--"}
            </div>
            <p className="text-xs text-muted-foreground">Rating</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="form">
        <TabsList>
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="going">Going</TabsTrigger>
          <TabsTrigger value="distance">Distance</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
        </TabsList>

        <TabsContent value="form" className="space-y-3">
          {horse.runners.length === 0 ? (
            <p className="text-muted-foreground">No race history</p>
          ) : (
            horse.runners.map((r) => (
              <Card key={`${r.race.id}`}>
                <CardContent className="flex items-center gap-4 py-3">
                  <div
                    className={`text-lg font-bold tabular-nums ${
                      r.finishPosition === 1
                        ? "text-green-500"
                        : r.finishPosition === 2
                          ? "text-blue-400"
                          : r.finishPosition === 3
                            ? "text-yellow-500"
                            : "text-muted-foreground"
                    }`}
                  >
                    {r.finishPosition ?? "-"}
                  </div>
                  <div className="flex-1">
                    <Link
                      href={`/races/${r.race.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.race.raceName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.race.course.name} &middot;{" "}
                      {new Date(r.race.date).toLocaleDateString("en-GB")} &middot;{" "}
                      {r.race.going} &middot; {r.race.raceType}
                    </div>
                  </div>
                  {r.jockey && (
                    <span className="text-xs text-muted-foreground">
                      {r.jockey.name}
                    </span>
                  )}
                  {r.oddsSp && (
                    <span className="text-sm tabular-nums">
                      SP {r.oddsSp.toFixed(1)}
                    </span>
                  )}
                  {r.gamblekingScore !== null && (
                    <span className="text-sm font-bold tabular-nums">
                      GK {r.gamblekingScore.toFixed(0)}
                    </span>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="going">
          <Card>
            <CardHeader>
              <CardTitle>Going Preference</CardTitle>
            </CardHeader>
            <CardContent>
              <GoingChart preferences={horse.goingPreferences} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distance">
          <Card>
            <CardHeader>
              <CardTitle>Distance Record</CardTitle>
            </CardHeader>
            <CardContent>
              {horse.distancePreferences.length === 0 ? (
                <p className="text-muted-foreground">No distance data</p>
              ) : (
                <div className="space-y-2">
                  {horse.distancePreferences.map((dp) => (
                    <div
                      key={dp.distanceBand}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">{dp.distanceBand}</span>
                      <span className="text-muted-foreground">
                        {dp.wins}/{dp.runs} wins ({dp.winPct.toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses">
          <Card>
            <CardHeader>
              <CardTitle>Course Form</CardTitle>
            </CardHeader>
            <CardContent>
              {horse.courseForm.length === 0 ? (
                <p className="text-muted-foreground">No course form data</p>
              ) : (
                <div className="space-y-2">
                  {horse.courseForm.map((cf) => (
                    <div
                      key={cf.course.name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">{cf.course.name}</span>
                      <span className="text-muted-foreground">
                        {cf.wins}/{cf.runs} wins ({cf.winPct.toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Race comments */}
      {horse.raceComments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Race Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {horse.raceComments.map((c, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{c.course}</span>{" "}
                  <span className="text-muted-foreground">
                    ({new Date(c.raceDate).toLocaleDateString("en-GB")})
                  </span>
                  : {c.comment}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
