import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, Users } from "lucide-react";
import { ConfidenceBadge } from "./confidence-badge";

interface RaceCardProps {
  race: {
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
  };
}

function formatDistance(furlongs: number): string {
  const miles = Math.floor(furlongs / 8);
  const remaining = furlongs % 8;
  if (miles === 0) return `${furlongs}f`;
  if (remaining === 0) return `${miles}m`;
  return `${miles}m${remaining}f`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RaceCard({ race }: RaceCardProps) {
  const topRunner = race.runners[0];

  return (
    <Link href={`/races/${race.id}`}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{race.raceName}</CardTitle>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span>
                  {race.course.name} ({race.course.country})
                </span>
                <Clock className="h-3 w-3" />
                <span>{formatTime(race.date)}</span>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">
              {race.raceType}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

          {topRunner && topRunner.gamblekingScore !== null && (
            <div className="mt-2 flex items-center gap-2 border-t pt-2">
              <span className="text-sm font-medium">
                Top Pick: {topRunner.horse.name}
              </span>
              <span className="text-sm tabular-nums font-bold">
                {topRunner.gamblekingScore.toFixed(0)}
              </span>
              <ConfidenceBadge level={topRunner.confidenceLevel} />
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
