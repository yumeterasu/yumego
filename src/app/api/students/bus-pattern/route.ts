import { NextRequest, NextResponse } from "next/server";
import {
  getBusPatternsForWeek,
  getBusPatternHistory,
  setBusPattern,
  BusLegMode,
} from "@/lib/sheets";

const VALID_LEG_MODES: BusLegMode[] = ["bus", "self"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/students/bus-pattern?week=YYYY-MM-DD -> { patterns } (every
// recorded exception for that school week (Monday date), across all
// students -- same all-students-then-filter-by-studentId shape as the old
// /api/students/transport)
// GET /api/students/bus-pattern?studentId=... -> { history } (every
// recorded week for that one student, oldest first)
export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get("week");
  const studentId = req.nextUrl.searchParams.get("studentId");

  try {
    if (studentId) {
      const history = await getBusPatternHistory(studentId);
      return NextResponse.json({ history });
    }
    if (!week || !DATE_RE.test(week)) {
      return NextResponse.json(
        { error: "Missing or invalid 'week' (expected YYYY-MM-DD, the Monday) or 'studentId'" },
        { status: 400 }
      );
    }
    const patterns = await getBusPatternsForWeek(week);
    return NextResponse.json({ patterns });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch bus patterns" }, { status: 500 });
  }
}

// PATCH /api/students/bus-pattern  { studentId, week: "YYYY-MM-DD", arrivalMode, departureMode }
// Setting both legs back to "self"/"self" (the default) clears the stored
// exception for that week rather than leaving a redundant row.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, week, arrivalMode, departureMode } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (typeof week !== "string" || !DATE_RE.test(week)) {
    return NextResponse.json({ error: "Invalid week (expected YYYY-MM-DD)" }, { status: 400 });
  }
  if (!VALID_LEG_MODES.includes(arrivalMode) || !VALID_LEG_MODES.includes(departureMode)) {
    return NextResponse.json({ error: "Invalid arrivalMode/departureMode" }, { status: 400 });
  }

  try {
    await setBusPattern(studentId, week, arrivalMode, departureMode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update bus pattern" }, { status: 500 });
  }
}
