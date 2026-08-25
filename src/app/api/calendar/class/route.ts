import { NextRequest, NextResponse } from "next/server";
import { getClassCalendarOverrides, setClassCalendarOverride } from "@/lib/sheets";

// GET /api/calendar/class?class=...
// Every date this class's calendar diverges from the Master default.
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  if (!className) {
    return NextResponse.json({ error: "Missing 'class' query param" }, { status: 400 });
  }

  try {
    const overrides = await getClassCalendarOverrides(className);
    return NextResponse.json({ overrides });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class calendar" }, { status: 500 });
  }
}

// PATCH /api/calendar/class  { className, date, isOpen: boolean | null, label?: string }
// isOpen: null removes the override (falls back to the Master default again).
// label: only meaningful when isOpen is false — this class's own name for the closure.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, date, isOpen, label } = body ?? {};

  if (
    !className ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (isOpen !== null && typeof isOpen !== "boolean") ||
    (label !== undefined && typeof label !== "string")
  ) {
    return NextResponse.json({ error: "Missing or invalid className/date/isOpen/label" }, { status: 400 });
  }

  try {
    await setClassCalendarOverride(className, date, isOpen, label);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class calendar" }, { status: 500 });
  }
}
