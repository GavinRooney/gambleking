"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BetFormProps {
  runnerId: string;
  horseName: string;
  currentOdds: number | null;
  onSubmit?: () => void;
}

export function BetForm({
  runnerId,
  horseName,
  currentOdds,
  onSubmit,
}: BetFormProps) {
  const [stake, setStake] = useState("");
  const [odds, setOdds] = useState(currentOdds?.toString() || "");
  const [betType, setBetType] = useState("win");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stake || !odds) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runnerId,
          stake: parseFloat(stake),
          oddsTaken: parseFloat(odds),
          betType,
          notes: notes || undefined,
        }),
      });

      if (res.ok) {
        setStake("");
        setOdds("");
        setNotes("");
        onSubmit?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium">
        Log bet: <span className="text-primary">{horseName}</span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="stake" className="text-xs">
            Stake
          </Label>
          <Input
            id="stake"
            type="number"
            step="0.5"
            min="0"
            placeholder="5.00"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="odds" className="text-xs">
            Odds (decimal)
          </Label>
          <Input
            id="odds"
            type="number"
            step="0.1"
            min="1"
            placeholder="3.5"
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="betType" className="text-xs">
          Type
        </Label>
        <Select value={betType} onValueChange={(v) => v && setBetType(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="win">Win</SelectItem>
            <SelectItem value="each_way">Each Way</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes" className="text-xs">
          Notes (optional)
        </Label>
        <Input
          id="notes"
          placeholder="Reasoning..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Logging..." : "Log Bet"}
      </Button>
    </form>
  );
}
