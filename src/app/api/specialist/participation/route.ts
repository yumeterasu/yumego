import { NextRequest, NextResponse } from "next/server";
import {
  getSpecialistParticipation,
  setSpecialistParticipationCount,
} from "@/lib/sheets";

// GET /api/specialist/participation?branch=プロンポン&month=2026-08
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
    const cells = await getSpecialistParticipation(branch, month);
    return NextResponse.json({ cells });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch participation" }, { status: 500 });
  }
}

// PATCH /api/specialist/participation  { branch, categoryId, grade, date, count: number | null }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { branch, categoryId, grade, date, count } = body ?? {};

  const countIsValid = count === null || (typeof count === "number" && Number.isFinite(count) && count >= 0);

  if (!branch || !categoryId || !grade || !date || !countIsValid) {
    return NextResponse.json(
      { error: "Missing branch, categoryId, grade, date, or invalid count" },
      { status: 400 }
    );
  }

  try {
    await setSpecialistParticipationCount(branch, categoryId, grade, date, count);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update participation" }, { status: 500 });
  }
}
