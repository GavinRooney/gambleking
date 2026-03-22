"use client";

import { Progress } from "@/components/ui/progress";

interface ScoreBreakdownProps {
  factors: {
    name: string;
    score: number;
    weight: number;
    weighted: number;
  }[];
  totalScore: number;
}

export function ScoreBreakdown({ factors, totalScore }: ScoreBreakdownProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-medium">
        <span>GambleKing Score</span>
        <span className="text-lg font-bold">{totalScore.toFixed(1)}</span>
      </div>
      <div className="space-y-1.5">
        {factors.map((f) => (
          <div key={f.name} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{f.name}</span>
              <span className="tabular-nums">
                {f.score.toFixed(0)} x {(f.weight * 100).toFixed(0)}% ={" "}
                {f.weighted.toFixed(1)}
              </span>
            </div>
            <Progress value={f.score} className="h-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}
