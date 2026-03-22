import { NextRequest, NextResponse } from "next/server";
import { getBestBets } from "@/lib/scoring/best-bets";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dateStr = searchParams.get("date");

  const date = dateStr ? new Date(dateStr) : new Date();

  try {
    const bestBets = await getBestBets(date);
    return NextResponse.json(bestBets);
  } catch (error) {
    console.error("Failed to get best bets:", error);
    return NextResponse.json(
      { error: "Failed to get best bets" },
      { status: 500 }
    );
  }
}
