import { NextResponse } from "next/server";
import { importThaiHolidays } from "@/lib/sheets";

// POST /api/calendar/master/import-thai
// One-time bulk import from Google's public "Holidays in Thailand" ICS
// feed. Only adds dates not already in MasterHolidays — safe to re-run.
export async function POST() {
  try {
    const result = await importThaiHolidays();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to import Thai holidays" }, { status: 500 });
  }
}
