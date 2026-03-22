import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ raceId: string }> }
) {
  const { raceId } = await params;

  try {
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      include: {
        course: true,
        runners: {
          include: {
            horse: {
              include: {
                goingPreferences: true,
                distancePreferences: true,
                courseForm: true,
                raceComments: { orderBy: { raceDate: "desc" }, take: 5 },
              },
            },
            jockey: true,
            trainer: true,
            bets: true,
          },
          orderBy: { gamblekingScore: "desc" },
        },
      },
    });

    if (!race) {
      return NextResponse.json({ error: "Race not found" }, { status: 404 });
    }

    return NextResponse.json(race);
  } catch (error) {
    console.error("Failed to fetch race:", error);
    return NextResponse.json(
      { error: "Failed to fetch race" },
      { status: 500 }
    );
  }
}
