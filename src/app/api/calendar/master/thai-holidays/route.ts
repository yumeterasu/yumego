import { NextResponse } from "next/server";
import { getThaiHolidaysPreview } from "@/lib/sheets";

// GET /api/calendar/master/thai-holidays -> { holidays }
// Read-only: just fetches and parses the public Thai holiday feed for
// display purposes (the タイの祝日を表示 checkbox on
// 祝日カレンダー（マスター）). Never writes to MasterHolidays.
export async function GET() {
  try {
    const holidays = await getThaiHolidaysPreview();
    return NextResponse.json({ holidays });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch Thai holidays" }, { status: 500 });
  }
}
