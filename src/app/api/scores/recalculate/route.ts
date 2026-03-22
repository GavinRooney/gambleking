import { NextRequest, NextResponse } from "next/server";
import { scoreAllRaces } from "@/lib/scoring/engine";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dateStr = (body as { date?: string }).date;
    const date = dateStr ? new Date(dateStr) : new Date();

    const result = await scoreAllRaces(date);
    return NextResponse.json({
      success: true,
      message: `Recalculated scores for ${date.toISOString().split("T")[0]}`,
      racesScored: result.size,
    });
  } catch (error) {
    console.error("Score recalculation failed:", error);
    return NextResponse.json(
      { error: "Failed to recalculate scores" },
      { status: 500 }
    );
  }
}
