import { NextRequest, NextResponse } from "next/server";
import { getSpecialistAttendance, setSpecialistChecked } from "@/lib/sheets";

// GET /api/specialist/attendance?branch=プロンポン&month=2026-08
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
    const cells = await getSpecialistAttendance(branch, month);
    return NextResponse.json({ cells });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 });
  }
}

// PATCH /api/specialist/attendance  { branch, categoryId, grade, date, checked }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { branch, categoryId, grade, date, checked } = body ?? {};

  if (!branch || !categoryId || !grade || !date || typeof checked !== "boolean") {
    return NextResponse.json(
      { error: "Missing branch, categoryId, grade, date, or checked" },
      { status: 400 }
    );
  }

  try {
    await setSpecialistChecked(branch, categoryId, grade, date, checked);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update attendance" }, { status: 500 });
  }
}
