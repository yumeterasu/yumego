import { NextRequest, NextResponse } from "next/server";
import { deleteAllInactiveStudents } from "@/lib/sheets";

// POST /api/students/purge-inactive  { className }
// Permanently removes EVERY currently-withdrawn student in this class --
// NOT recoverable. The "削除した生徒を表示" list otherwise only ever grows,
// since withdrawing (削除する) is soft-delete by design.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { className } = body ?? {};

  if (!className || typeof className !== "string") {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }

  try {
    const removed = await deleteAllInactiveStudents(className);
    return NextResponse.json({ removed });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to purge inactive students" }, { status: 500 });
  }
}
