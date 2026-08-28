import { NextRequest, NextResponse } from "next/server";
import {
  getStudentsByBranch,
  getPickupRecordsForMonth,
  upsertPickupRecord,
  bulkSetPickupField,
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

// POST /api/pickup  { date, studentIds: string[] }
// Marks 登園 "TRUE" for every id in studentIds on this date, in one batched
// write -- 送迎管理's "本日は全員登園" button. Individual absentees get
// tapped off afterward via the normal per-cell toggle, same as any day.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, studentIds } = body ?? {};

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Array.isArray(studentIds) ||
    studentIds.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json({ error: "Missing or invalid date/studentIds" }, { status: 400 });
  }

  try {
    await bulkSetPickupField(date, studentIds, "arrival");
    return NextResponse.json({ ok: true, count: studentIds.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
