import { NextRequest, NextResponse } from "next/server";
import {
  getBusPatternsForWeek,
  getBusPatternsForMonth,
  getBusPatternsForRange,
  getBusPatternHistory,
  setBusPattern,
  setBusPatternForMonth,
  BusLegMode,
} from "@/lib/sheets";

const VALID_LEG_MODES: BusLegMode[] = ["bus", "self"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/students/bus-pattern?start=YYYY-MM-DD&end=YYYY-MM-DD ->
// { patterns } (every recorded exception across every school week
// overlapping that date range, so バス・送迎設定 can show a whole term's
// weeks at once)
// GET /api/students/bus-pattern?month=YYYY-MM -> { patterns } (same, for
// just one month)
// GET /api/students/bus-pattern?week=YYYY-MM-DD -> { patterns } (just one
// school week, by its Monday date)
// GET /api/students/bus-pattern?studentId=... -> { history } (every
// recorded week for that one student, oldest first)
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const month = req.nextUrl.searchParams.get("month");
  const week = req.nextUrl.searchParams.get("week");
  const studentId = req.nextUrl.searchParams.get("studentId");

  try {
    if (studentId) {
      const history = await getBusPatternHistory(studentId);
      return NextResponse.json({ history });
    }
    if (start || end) {
      if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
        return NextResponse.json(
          { error: "Invalid start/end (expected YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      const patterns = await getBusPatternsForRange(start, end);
      return NextResponse.json({ patterns });
    }
    if (month) {
      if (!YEAR_MONTH_RE.test(month)) {
        return NextResponse.json({ error: "Invalid month (expected YYYY-MM)" }, { status: 400 });
      }
      const patterns = await getBusPatternsForMonth(month);
      return NextResponse.json({ patterns });
    }
    if (!week || !DATE_RE.test(week)) {
      return NextResponse.json(
        { error: "Missing or invalid 'start'/'end', 'month', 'week', or 'studentId'" },
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

// PATCH /api/students/bus-pattern  { studentId, month: "YYYY-MM", arrivalMode, departureMode }
// Sets the pattern uniformly across every school week in that month --
// バス・送迎設定's normal write path now (per-week control turned out to
// be finer than staff wanted; see setBusPatternForMonth in sheets.ts).
// PATCH /api/students/bus-pattern  { studentId, week: "YYYY-MM-DD", arrivalMode, departureMode }
// Sets just one school week (still supported for callers that want
// finer control). Either way, setting both legs back to "self"/"self"
// (the default) clears the stored exception rather than leaving a
// redundant row.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, month, week, arrivalMode, departureMode } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (!VALID_LEG_MODES.includes(arrivalMode) || !VALID_LEG_MODES.includes(departureMode)) {
    return NextResponse.json({ error: "Invalid arrivalMode/departureMode" }, { status: 400 });
  }

  try {
    if (month !== undefined) {
      if (typeof month !== "string" || !YEAR_MONTH_RE.test(month)) {
        return NextResponse.json({ error: "Invalid month (expected YYYY-MM)" }, { status: 400 });
      }
      await setBusPatternForMonth(studentId, month, arrivalMode, departureMode);
      return NextResponse.json({ ok: true });
    }
    if (typeof week !== "string" || !DATE_RE.test(week)) {
      return NextResponse.json(
        { error: "Missing or invalid 'month' (expected YYYY-MM) or 'week' (expected YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    await setBusPattern(studentId, week, arrivalMode, departureMode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update bus pattern" }, { status: 500 });
  }
}
