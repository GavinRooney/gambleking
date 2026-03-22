import { NextRequest, NextResponse } from "next/server";
import { syncResults } from "@/lib/data-sources/sync";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = (body as { date?: string }).date || "today";

    const result = await syncResults(date);
    return NextResponse.json({
      success: true,
      message: `Synced results for ${date}`,
      ...result,
    });
  } catch (error) {
    console.error("Results sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync results" },
      { status: 500 }
    );
  }
}
