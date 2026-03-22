import { NextRequest, NextResponse } from "next/server";
import { syncRaceCards } from "@/lib/data-sources/sync";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let date = (body as { date?: string }).date || "today";

    // Map YYYY-MM-DD to today/tomorrow if applicable
    if (date !== "today" && date !== "tomorrow") {
      const today = new Date().toISOString().split("T")[0];
      const tmrw = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];

      if (date === today) {
        date = "today";
      } else if (date === tmrw) {
        date = "tomorrow";
      } else {
        return NextResponse.json(
          {
            success: false,
            message: "The Racing API (Basic plan) only supports today and tomorrow. Upgrade to Standard for historical dates.",
          },
          { status: 400 }
        );
      }
    }

    const result = await syncRaceCards(date);
    return NextResponse.json({
      success: true,
      message: `Synced race cards for ${date}`,
      ...result,
    });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync race cards" },
      { status: 500 }
    );
  }
}
