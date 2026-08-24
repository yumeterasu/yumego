import { NextRequest, NextResponse } from "next/server";
import {
  upsertAttendance,
  getAttendanceForMonth,
  clearAttendance,
  clearAttendanceForDate,
  AttendanceRecord,
  AttendanceStatus,
} from "@/lib/sheets";

const VALID_STATUSES: AttendanceStatus[] = [
  "present",
  "absent",
  "late",
  "early_leave",
  "suspended",
];

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
// body: { date, className, records: [{ studentId, status, reason? }] }
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
    (r: { studentId: string; status: AttendanceStatus; reason?: string }) => ({
      date,
      className,
      studentId: r.studentId,
      status: VALID_STATUSES.includes(r.status) ? r.status : "present",
      reason: r.reason ?? "",
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
// body: { date, className, studentId, status: AttendanceStatus | null, reason? }
// Used by the dashboard to correct a single day/student after the fact.
// status: null clears the cell back to "not checked yet" (removes the row).
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { date, className, studentId, status, reason } = body ?? {};

  const statusIsValid =
    status === null ||
    (typeof status === "string" &&
      VALID_STATUSES.includes(status as AttendanceStatus));

  if (!date || !className || !studentId || !statusIsValid) {
    return NextResponse.json(
      { error: "Missing date, className, studentId, or invalid status" },
      { status: 400 }
    );
  }

  try {
    if (status === null) {
      await clearAttendance(date, studentId);
    } else {
      await upsertAttendance([
        {
          date,
          className,
          studentId,
          status,
          reason: typeof reason === "string" ? reason : "",
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

// DELETE /api/attendance?class=...&date=2026-08-21
// Clears EVERY student's row for that class+date at once — for undoing a
// whole day that was checked in wrong, instead of clearing cells one by one.
export async function DELETE(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const date = req.nextUrl.searchParams.get("date");

  if (!className || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'date' query params" },
      { status: 400 }
    );
  }

  try {
    const count = await clearAttendanceForDate(className, date);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to clear attendance for that day" },
      { status: 500 }
    );
  }
}
