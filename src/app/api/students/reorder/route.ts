import { NextRequest, NextResponse } from "next/server";
import { reorderStudents } from "@/lib/sheets";

// POST /api/students/reorder  { studentIds: string[] }
// Commits a whole new display order in one write -- the roster page's
// 並び替え (reorder) mode only rearranges local state while unlocked;
// this is the single save that happens when 保存 is pressed. studentIds
// is the full ordered list for whichever class was being edited.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { studentIds } = body ?? {};

  if (!Array.isArray(studentIds) || studentIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "studentIds must be a string array" }, { status: 400 });
  }

  try {
    await reorderStudents(studentIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save the new order" }, { status: 500 });
  }
}
