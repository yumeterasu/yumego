import { NextRequest, NextResponse } from "next/server";
import {
  getBusPatternsForMonth,
  getBusPatternHistory,
  setBusPattern,
  BusLegMode,
} from "@/lib/sheets";

const VALID_LEG_MODES: BusLegMode[] = ["bus", "self"];
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/students/bus-pattern?month=YYYY-MM -> { patterns } (every
// recorded exception for that month, across all students -- same
// all-students-then-filter-by-studentId shape as /api/students/transport)
// GET /api/students/bus-pattern?studentId=... -> { history } (every
// recorded month for that one student, oldest first)
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  const studentId = req.nextUrl.searchParams.get("studentId");

  try {
    if (studentId) {
      const history = await getBusPatternHistory(studentId);
      return NextResponse.json({ history });
    }
    if (!month || !YEAR_MONTH_RE.test(month)) {
      return NextResponse.json(
        { error: "Missing or invalid 'month' (expected YYYY-MM) or 'studentId'" },
        { status: 400 }
      );
    }
    const patterns = await getBusPatternsForMonth(month);
    return NextResponse.json({ patterns });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch bus patterns" }, { status: 500 });
  }
}

// PATCH /api/students/bus-pattern  { studentId, month: "YYYY-MM", arrivalMode, departureMode }
// Setting both legs back to "bus"/"bus" (the default) clears the stored
// exception for that month rather than leaving a redundant row.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, month, arrivalMode, departureMode } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (typeof month !== "string" || !YEAR_MONTH_RE.test(month)) {
    return NextResponse.json({ error: "Invalid month (expected YYYY-MM)" }, { status: 400 });
  }
  if (!VALID_LEG_MODES.includes(arrivalMode) || !VALID_LEG_MODES.includes(departureMode)) {
    return NextResponse.json({ error: "Invalid arrivalMode/departureMode" }, { status: 400 });
  }

  try {
    await setBusPattern(studentId, month, arrivalMode, departureMode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update bus pattern" }, { status: 500 });
  }
}
