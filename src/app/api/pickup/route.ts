import { NextRequest, NextResponse } from "next/server";
import {
  getStudentsByBranch,
  getPickupRecordsForMonth,
  upsertPickupRecord,
  bulkSetArrivalForRoster,
  clearPickupForDate,
} from "@/lib/sheets";

// GET /api/pickup?branch=プロンポン&month=2026-08
// Whole-branch roster (all classes/grades) + this month's 登園/降園 times.
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch");
  const month = req.nextUrl.searchParams.get("month");

  if (!branch || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'branch'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const [students, allRecords] = await Promise.all([
      getStudentsByBranch(branch),
      getPickupRecordsForMonth(month),
    ]);
    const studentIds = new Set(students.map((s) => s.studentId));
    const records = allRecords.filter((r) => studentIds.has(r.studentId));
    return NextResponse.json({ students, records });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch pickup data" }, { status: 500 });
  }
}

// PATCH /api/pickup  { date, studentId, arrivalTime?, departureTime? }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { date, studentId, arrivalTime, departureTime } = body ?? {};

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof studentId !== "string" ||
    !studentId ||
    (arrivalTime === undefined && departureTime === undefined) ||
    (arrivalTime !== undefined && typeof arrivalTime !== "string") ||
    (departureTime !== undefined && typeof departureTime !== "string")
  ) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  try {
    await upsertPickupRecord(date, studentId, { arrivalTime, departureTime });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

// POST /api/pickup  { date, entries: { studentId, present }[] }
// Sets 登園 for a whole roster on one date at once, in one batched write --
// 送迎管理's 登園確認 screen (mirrors /attendance's own card-grid check-in,
// just present/absent, no reason codes).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, entries } = body ?? {};

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Array.isArray(entries) ||
    entries.some(
      (e) => typeof e?.studentId !== "string" || typeof e?.present !== "boolean"
    )
  ) {
    return NextResponse.json({ error: "Missing or invalid date/entries" }, { status: 400 });
  }

  try {
    await bulkSetArrivalForRoster(date, entries);
    return NextResponse.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

// DELETE /api/pickup?branch=...&date=2026-08-21
// Clears EVERY student's 登園/降園 record for that branch+date at once --
// same "delete a whole day" pattern as the Dashboard's own
// DELETE /api/attendance.
export async function DELETE(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch");
  const date = req.nextUrl.searchParams.get("date");

  if (!branch || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid 'branch'/'date' query params" },
      { status: 400 }
    );
  }

  try {
    const count = await clearPickupForDate(branch, date);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to clear pickup for that day" }, { status: 500 });
  }
}
