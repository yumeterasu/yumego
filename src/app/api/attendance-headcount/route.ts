import { NextRequest, NextResponse } from "next/server";
import { getHeadcountEntry, setHeadcountEntry } from "@/lib/sheets";

// GET /api/attendance-headcount?class=...&date=YYYY-MM-DD
// Returns { entry: { total, present, absent } | null } for a
// headcount-only class (ExtraClass.kind === "headcount").
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const date = req.nextUrl.searchParams.get("date");

  if (!className || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'date' query param" },
      { status: 400 }
    );
  }

  try {
    const entry = await getHeadcountEntry(className, date);
    return NextResponse.json({ entry });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch headcount entry" }, { status: 500 });
  }
}

// PATCH /api/attendance-headcount  { className, date, total, present, absent }
// Each of total/present/absent is a number or null (null clears that field).
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, date, total, present, absent } = body ?? {};

  const isValidField = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

  if (
    typeof className !== "string" ||
    !className ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !isValidField(total) ||
    !isValidField(present) ||
    !isValidField(absent)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid className/date/total/present/absent" },
      { status: 400 }
    );
  }

  try {
    await setHeadcountEntry(className, date, { total, present, absent });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save headcount entry" }, { status: 500 });
  }
}
