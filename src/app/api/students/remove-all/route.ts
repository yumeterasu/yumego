import { NextRequest, NextResponse } from "next/server";
import { deactivateAllStudents } from "@/lib/sheets";

// POST /api/students/remove-all
// body: { className }
// Soft-deletes every currently active student in the class in one batched
// write — for quickly undoing a bulk-add mistake instead of removing one
// by one. Still fully recoverable per-student from the "removed" list.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { className } = body ?? {};

  if (!className || typeof className !== "string") {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }

  try {
    const removed = await deactivateAllStudents(className);
    return NextResponse.json({ removed });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to remove students" }, { status: 500 });
  }
}
