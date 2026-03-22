"use client";

interface GoingPreference {
  going: string;
  runs: number;
  wins: number;
  places: number;
  winPct: number;
}

interface GoingChartProps {
  preferences: GoingPreference[];
}

const GOING_ORDER = ["firm", "good", "good_to_soft", "soft", "heavy"];

const GOING_LABELS: Record<string, string> = {
  firm: "Firm",
  good: "Good",
  good_to_soft: "GtS",
  soft: "Soft",
  heavy: "Heavy",
};

export function GoingChart({ preferences }: GoingChartProps) {
  if (!preferences.length) {
    return (
      <p className="text-sm text-muted-foreground">No going data available</p>
    );
  }

  const sorted = [...preferences].sort(
    (a, b) => GOING_ORDER.indexOf(a.going) - GOING_ORDER.indexOf(b.going)
  );

  const maxRuns = Math.max(...sorted.map((p) => p.runs), 1);

  return (
    <div className="space-y-2">
      {sorted.map((pref) => (
        <div key={pref.going} className="flex items-center gap-3 text-sm">
          <span className="w-10 text-right text-muted-foreground">
            {GOING_LABELS[pref.going] || pref.going}
          </span>
          <div className="flex flex-1 items-center gap-2">
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded bg-primary/40"
                style={{ width: `${(pref.runs / maxRuns) * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded bg-green-600"
                style={{ width: `${(pref.wins / maxRuns) * 100}%` }}
              />
            </div>
            <span className="w-24 tabular-nums text-xs text-muted-foreground">
              {pref.wins}/{pref.runs} ({pref.winPct.toFixed(0)}%)
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
