"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Database, Calculator, Download } from "lucide-react";

interface SyncResult {
  success: boolean;
  message: string;
  [key: string]: unknown;
}

export default function AdminPage() {
  const [syncDate, setSyncDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [results, setResults] = useState<
    { action: string; result: SyncResult; timestamp: string }[]
  >([]);
  const [loading, setLoading] = useState<string | null>(null);

  const runAction = async (
    action: string,
    url: string,
    body?: Record<string, string>
  ) => {
    setLoading(action);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const result = await res.json();
      setResults((prev) => [
        {
          action,
          result,
          timestamp: new Date().toLocaleTimeString("en-GB"),
        },
        ...prev,
      ]);
    } catch (err) {
      setResults((prev) => [
        {
          action,
          result: {
            success: false,
            message: String(err),
          },
          timestamp: new Date().toLocaleTimeString("en-GB"),
        },
        ...prev,
      ]);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Date selector */}
        <Card className="md:col-span-2">
          <CardContent className="flex items-end gap-4 pt-4">
            <div className="space-y-1">
              <Label htmlFor="syncDate">Target Date</Label>
              <Input
                id="syncDate"
                type="date"
                value={syncDate}
                onChange={(e) => setSyncDate(e.target.value)}
                className="w-48"
              />
            </div>
            <Button
              variant="outline"
              onClick={() =>
                setSyncDate(new Date().toISOString().split("T")[0])
              }
            >
              Today
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                setSyncDate(d.toISOString().split("T")[0]);
              }}
            >
              Tomorrow
            </Button>
          </CardContent>
        </Card>

        {/* Data sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Data Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full justify-start"
              onClick={() =>
                runAction("Sync Race Cards", "/api/sync", {
                  date: syncDate,
                })
              }
              disabled={loading !== null}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading === "Sync Race Cards" ? "animate-spin" : ""}`}
              />
              Sync Race Cards
            </Button>

            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() =>
                runAction("Sync Results", "/api/sync/results", {
                  date: syncDate,
                })
              }
              disabled={loading !== null}
            >
              <Download
                className={`mr-2 h-4 w-4 ${loading === "Sync Results" ? "animate-spin" : ""}`}
              />
              Sync Results
            </Button>
          </CardContent>
        </Card>

        {/* Scoring */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Scoring
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full justify-start"
              onClick={() =>
                runAction("Recalculate Scores", "/api/scores/recalculate", {
                  date: syncDate,
                })
              }
              disabled={loading !== null}
            >
              <Calculator
                className={`mr-2 h-4 w-4 ${loading === "Recalculate Scores" ? "animate-spin" : ""}`}
              />
              Recalculate Scores
            </Button>

            <p className="text-xs text-muted-foreground">
              Re-run scoring engine for all races on the selected date. Use after
              syncing new data or adjusting weights.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Action log */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Action Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {results.map((r, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{r.timestamp}</span>
                  <span className="font-medium">{r.action}</span>
                  <span
                    className={
                      r.result.success ? "text-green-500" : "text-red-500"
                    }
                  >
                    {r.result.success ? "OK" : "FAILED"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.result.message}
                </p>
                {i < results.length - 1 && <Separator className="mt-2" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
