import { NextRequest, NextResponse } from "next/server";
import { getAttendanceSummaryForDate } from "@/lib/sheets";

// GET /api/attendance/daily?date=2026-08-06
// Returns present-count per class for that date, across ALL classes.
// A class missing from the result hasn't checked in yet that day.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid 'date' query param" },
      { status: 400 }
    );
  }

  try {
    const summary = await getAttendanceSummaryForDate(date);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch daily summary" },
      { status: 500 }
    );
  }
}
