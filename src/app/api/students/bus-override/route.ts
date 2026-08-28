import { NextRequest, NextResponse } from "next/server";
import { getBusOverridesForMonth, setBusOverride, clearBusOverride, BusLegMode } from "@/lib/sheets";

const VALID_LEG_MODES: BusLegMode[] = ["bus", "self"];
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/students/bus-override?month=YYYY-MM -> { overrides }
// Every one-off single-day exception falling in that month, across all
// students -- layered on top of that day's school-week 週次バスパターン.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !YEAR_MONTH_RE.test(month)) {
    return NextResponse.json({ error: "Missing or invalid 'month' (expected YYYY-MM)" }, { status: 400 });
  }
  try {
    const overrides = await getBusOverridesForMonth(month);
    return NextResponse.json({ overrides });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch bus overrides" }, { status: 500 });
  }
}

// PATCH /api/students/bus-override  { studentId, date: "YYYY-MM-DD", arrivalMode, departureMode }
// A single-day exception -- e.g. a bus/bus week where the parent asks for
// pickup themselves just one day -- without touching that week's own
// setting.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, date, arrivalMode, departureMode } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const dow = new Date(date + "T00:00:00").getDay();
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ error: "No school on weekends" }, { status: 400 });
  }
  if (!VALID_LEG_MODES.includes(arrivalMode) || !VALID_LEG_MODES.includes(departureMode)) {
    return NextResponse.json({ error: "Invalid arrivalMode/departureMode" }, { status: 400 });
  }

  try {
    await setBusOverride(studentId, date, arrivalMode, departureMode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to set bus override" }, { status: 500 });
  }
}

// DELETE /api/students/bus-override?studentId=...&date=YYYY-MM-DD
// Reverts that single day back to whatever its school week's own pattern
// says.
export async function DELETE(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  const date = req.nextUrl.searchParams.get("date");
  if (!studentId || !date || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid 'studentId'/'date' query params" },
      { status: 400 }
    );
  }
  try {
    await clearBusOverride(studentId, date);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to clear bus override" }, { status: 500 });
  }
}
