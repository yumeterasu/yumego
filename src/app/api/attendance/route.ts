import { NextRequest, NextResponse } from "next/server";
import {
  upsertAttendance,
  getAttendanceForMonth,
  clearAttendance,
  AttendanceRecord,
} from "@/lib/sheets";

// GET /api/attendance?class=...&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const month = req.nextUrl.searchParams.get("month");

  if (!className || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const records = await getAttendanceForMonth(className, month);
    return NextResponse.json({ records });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch attendance" },
      { status: 500 }
    );
  }
}

// POST /api/attendance
// body: { date: "2026-08-05", className: "...", records: [{ studentId, present }] }
// Used by the daily check-in flow. Safe to resubmit the same day — existing
// rows for that date+student are updated in place, not duplicated.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, className, records } = body ?? {};

  if (!date || !className || !Array.isArray(records)) {
    return NextResponse.json(
      { error: "Missing date, className, or records" },
      { status: 400 }
    );
  }

  const timestamp = new Date().toISOString();

  const rows: AttendanceRecord[] = records.map(
    (r: { studentId: string; present: boolean }) => ({
      date,
      className,
      studentId: r.studentId,
      present: r.present,
      timestamp,
    })
  );

  try {
    await upsertAttendance(rows);
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to submit attendance" },
      { status: 500 }
    );
  }
}

// PATCH /api/attendance
// body: { date: "2026-08-05", className: "...", studentId: "...", present: true | false | null }
// Used by the dashboard to correct a single day/student after the fact.
// present: null clears the cell back to "not checked yet" (removes the row).
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { date, className, studentId, present } = body ?? {};

  if (
    !date ||
    !className ||
    !studentId ||
    (typeof present !== "boolean" && present !== null)
  ) {
    return NextResponse.json(
      { error: "Missing date, className, studentId, or present" },
      { status: 400 }
    );
  }

  try {
    if (present === null) {
      await clearAttendance(date, studentId);
    } else {
      await upsertAttendance([
        {
          date,
          className,
          studentId,
          present,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update attendance" },
      { status: 500 }
    );
  }
}
