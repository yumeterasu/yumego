import { NextRequest, NextResponse } from "next/server";
import { submitAttendance, AttendanceRecord } from "@/lib/sheets";

// POST /api/attendance
// body: { date: "2026-08-05", className: "...", records: [{ studentId, present }] }
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
    await submitAttendance(rows);
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to submit attendance" },
      { status: 500 }
    );
  }
}
