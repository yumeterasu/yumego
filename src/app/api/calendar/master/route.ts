import { NextRequest, NextResponse } from "next/server";
import { getMasterHolidays, setMasterHoliday } from "@/lib/sheets";

// GET /api/calendar/master
// School-wide holiday list — not scoped to a class or branch.
export async function GET() {
  try {
    const holidays = await getMasterHolidays();
    return NextResponse.json({ holidays });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch holidays" }, { status: 500 });
  }
}

// PATCH /api/calendar/master  { date, label: string | null }
// label: null removes the date from the holiday list; a string (even "") sets it.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { date, label } = body ?? {};

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (label !== null && typeof label !== "string")
  ) {
    return NextResponse.json({ error: "Missing or invalid date/label" }, { status: 400 });
  }

  try {
    await setMasterHoliday(date, label);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update holiday" }, { status: 500 });
  }
}
