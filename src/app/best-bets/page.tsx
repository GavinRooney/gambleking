"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { MapPin, Clock, Users } from "lucide-react";

interface BestBetData {
  race: {
    id: string;
    raceName: string;
    raceType: string;
    date: string;
    distanceFurlongs: number;
    going: string | null;
    class: number | null;
    numRunners: number | null;
    course: { name: string; country: string };
  };
  topRunner: {
    id: string;
    gamblekingScore: number | null;
    confidenceLevel: string | null;
    oddsBest: number | null;
    horse: { name: string; id: string };
    jockey: { name: string } | null;
    trainer: { name: string } | null;
  };
  scoreGap: number;
  reasons: string[];
}

export default function BestBetsPage() {
  const [bestBets, setBestBets] = useState<BestBetData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/best-bets");
        if (res.ok) setBestBets(await res.json());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Best Bets</h1>
        <p className="text-muted-foreground">
          High-confidence picks based on scoring analysis
        </p>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && bestBets.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No best bets identified for today. Sync race cards and run scoring
            from the Admin page.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {bestBets.map((bb) => (
          <Card key={bb.race.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    <Link
                      href={`/races/${bb.race.id}`}
                      className="hover:underline"
                    >
                      {bb.race.raceName}
                    </Link>
                  </CardTitle>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span>{bb.race.course.name}</span>
                    <Clock className="h-3 w-3" />
                    <span>
                      {new Date(bb.race.date).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Users className="h-3 w-3" />
                    <span>{bb.race.numRunners} runners</span>
                  </div>
                </div>
                <ConfidenceBadge level={bb.topRunner.confidenceLevel} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/horses/${bb.topRunner.horse.id}`}
                    className="text-lg font-bold hover:underline"
                  >
                    {bb.topRunner.horse.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {bb.topRunner.jockey && (
                      <span>J: {bb.topRunner.jockey.name}</span>
                    )}
                    {bb.topRunner.trainer && (
                      <span className="ml-2">
                        T: {bb.topRunner.trainer.name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums">
                    {bb.topRunner.gamblekingScore?.toFixed(0)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    gap: +{bb.scoreGap.toFixed(0)}
                  </div>
                  {bb.topRunner.oddsBest && (
                    <div className="text-sm font-semibold tabular-nums">
                      {bb.topRunner.oddsBest.toFixed(1)}
                    </div>
                  )}
                </div>
              </div>

              {bb.reasons && bb.reasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {bb.reasons.map((reason, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {reason}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{bb.race.raceType}</Badge>
                {bb.race.going && <span>{bb.race.going}</span>}
                {bb.race.class && <span>Class {bb.race.class}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
