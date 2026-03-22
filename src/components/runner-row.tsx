import Link from "next/link";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "./confidence-badge";
import { FormFigures } from "./form-figures";

interface RunnerRowProps {
  runner: {
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
    };
    jockey: { name: string } | null;
    trainer: { name: string } | null;
  };
  rank: number;
  recentForm?: (number | null)[];
  showResult?: boolean;
}

export function RunnerRow({
  runner,
  rank,
  recentForm = [],
  showResult = false,
}: RunnerRowProps) {
  const score = runner.gamblekingScore;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-3 py-2.5 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center",
        rank === 1 && score !== null && "bg-green-500/5"
      )}
    >
      {/* Rank & Score */}
      <div className="flex items-center gap-3 sm:w-20">
        <span className="text-lg font-bold tabular-nums text-muted-foreground">
          {rank}
        </span>
        {score !== null && (
          <span className="text-lg font-bold tabular-nums">{score.toFixed(0)}</span>
        )}
      </div>

      {/* Horse info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/horses/${runner.horse.id}`}
            className="font-semibold truncate hover:underline"
          >
            {runner.horse.name}
          </Link>
          {runner.horse.age && (
            <span className="text-xs text-muted-foreground">
              {runner.horse.age}yo
            </span>
          )}
          <ConfidenceBadge level={runner.confidenceLevel} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {runner.jockey && <span>J: {runner.jockey.name}</span>}
          {runner.trainer && <span>T: {runner.trainer.name}</span>}
        </div>
      </div>

      {/* Form */}
      <div className="sm:w-28">
        <FormFigures positions={recentForm} />
      </div>

      {/* Race details */}
      <div className="flex items-center gap-4 text-sm sm:w-48">
        {runner.drawPosition && (
          <span className="text-xs text-muted-foreground">
            Draw {runner.drawPosition}
          </span>
        )}
        {runner.weightCarried && (
          <span className="text-xs text-muted-foreground">
            {runner.weightCarried}
          </span>
        )}
        {runner.officialRating && (
          <span className="text-xs text-muted-foreground">
            OR {runner.officialRating}
          </span>
        )}
      </div>

      {/* Odds */}
      <div className="flex items-center gap-2 sm:w-24 sm:justify-end">
        {runner.oddsBest && (
          <span className="font-semibold tabular-nums">
            {runner.oddsBest.toFixed(1)}
          </span>
        )}
        {runner.oddsSp && (
          <span className="text-xs text-muted-foreground tabular-nums">
            SP {runner.oddsSp.toFixed(1)}
          </span>
        )}
      </div>

      {/* Result */}
      {showResult && runner.finishPosition !== null && (
        <div className="sm:w-16 sm:text-right">
          <span
            className={cn(
              "font-bold tabular-nums",
              runner.finishPosition === 1 && "text-green-500",
              runner.finishPosition === 2 && "text-blue-400",
              runner.finishPosition === 3 && "text-yellow-500"
            )}
          >
            {runner.finishPosition === 1
              ? "1st"
              : runner.finishPosition === 2
                ? "2nd"
                : runner.finishPosition === 3
                  ? "3rd"
                  : `${runner.finishPosition}th`}
          </span>
        </div>
      )}
    </div>
  );
}
