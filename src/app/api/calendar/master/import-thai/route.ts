import { NextRequest, NextResponse } from "next/server";
import { applyMasterHolidayChanges } from "@/lib/sheets";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/calendar/master/import-thai  { toSet: {date,label}[], toRemove: string[] }
// The client computes the diff itself (it already has both the current
// MasterHolidays and the Thai feed loaded, from the タイの祝日を表示
// checkbox) and shows it in a confirm modal before ever calling this --
// this endpoint just applies exactly the change list it's given.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { toSet, toRemove } = body ?? {};

  if (
    !Array.isArray(toSet) ||
    toSet.some(
      (h) =>
        typeof h?.date !== "string" ||
        !DATE_RE.test(h.date) ||
        typeof h?.label !== "string"
    ) ||
    !Array.isArray(toRemove) ||
    toRemove.some((d) => typeof d !== "string" || !DATE_RE.test(d))
  ) {
    return NextResponse.json(
      { error: "Invalid toSet (array of {date, label}) or toRemove (array of date strings)" },
      { status: 400 }
    );
  }

  try {
    await applyMasterHolidayChanges(toSet, toRemove);
    return NextResponse.json({ ok: true, added: toSet.length, removed: toRemove.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to import Thai holidays" }, { status: 500 });
  }
}
