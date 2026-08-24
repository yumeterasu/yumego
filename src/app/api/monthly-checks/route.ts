import { NextRequest, NextResponse } from "next/server";
import { getMonthlyChecks, setMonthlyCheck, type MonthlyCheckColumn } from "@/lib/sheets";

const CHECK_COLUMNS: MonthlyCheckColumn[] = ["check1", "check2", "check3"];

// GET /api/monthly-checks?class=...&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const month = req.nextUrl.searchParams.get("month");

  if (!className || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const checks = await getMonthlyChecks(className, month);
    return NextResponse.json({ checks });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch monthly checks" }, { status: 500 });
  }
}

// PATCH /api/monthly-checks  { className, month, studentId, column, value }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, month, studentId, column, value } = body ?? {};

  if (
    !className ||
    !month ||
    !/^\d{4}-\d{2}$/.test(month) ||
    !studentId ||
    !CHECK_COLUMNS.includes(column) ||
    typeof value !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Missing className, month, studentId, column, or value" },
      { status: 400 }
    );
  }

  try {
    await setMonthlyCheck(className, month, studentId, column, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update monthly check" }, { status: 500 });
  }
}
