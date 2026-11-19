import { NextRequest, NextResponse } from "next/server";
import { getEarliestAttendanceDatePerStudent } from "@/lib/sheets";

// GET /api/attendance/earliest?class=...&fiscalYear=2026
// fiscalYear=2026 means the school year April 2026 - March 2027.
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const fiscalYearRaw = req.nextUrl.searchParams.get("fiscalYear");
  const fiscalYear = fiscalYearRaw ? Number(fiscalYearRaw) : NaN;

  if (!className || !fiscalYearRaw || !Number.isInteger(fiscalYear)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'fiscalYear' query params" },
      { status: 400 }
    );
  }

  try {
    const earliestMap = await getEarliestAttendanceDatePerStudent(className, fiscalYear);
    return NextResponse.json({ earliest: Object.fromEntries(earliestMap) });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch earliest attendance" },
      { status: 500 }
    );
  }
}
