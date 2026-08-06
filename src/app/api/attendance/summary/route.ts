import { NextRequest, NextResponse } from "next/server";
import { getAttendanceForFiscalYear } from "@/lib/sheets";

// GET /api/attendance/summary?class=...&fiscalYear=2026
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
    const records = await getAttendanceForFiscalYear(className, fiscalYear);
    return NextResponse.json({ records });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch attendance summary" },
      { status: 500 }
    );
  }
}
