import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const horse = await prisma.horse.findUnique({
      where: { id },
      include: {
        trainer: true,
        goingPreferences: true,
        distancePreferences: true,
        courseForm: { include: { course: true } },
        raceComments: { orderBy: { raceDate: "desc" }, take: 20 },
        runners: {
          include: {
            race: { include: { course: true } },
            jockey: true,
          },
          orderBy: { race: { date: "desc" } },
          take: 20,
        },
      },
    });

    if (!horse) {
      return NextResponse.json({ error: "Horse not found" }, { status: 404 });
    }

    return NextResponse.json(horse);
  } catch (error) {
    console.error("Failed to fetch horse:", error);
    return NextResponse.json(
      { error: "Failed to fetch horse" },
      { status: 500 }
    );
  }
}
