import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dateStr = searchParams.get("date");

  const date = dateStr ? new Date(dateStr) : new Date();
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const races = await prisma.race.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        course: true,
        runners: {
          include: { horse: true, jockey: true, trainer: true },
          orderBy: { gamblekingScore: "desc" },
        },
      },
      orderBy: [{ course: { name: "asc" } }, { date: "asc" }],
    });

    return NextResponse.json(races);
  } catch (error) {
    console.error("Failed to fetch races:", error);
    return NextResponse.json(
      { error: "Failed to fetch races" },
      { status: 500 }
    );
  }
}
