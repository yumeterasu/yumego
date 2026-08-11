import { NextRequest, NextResponse } from "next/server";
import { promoteClassStudents } from "@/lib/sheets";

// POST /api/students/promote
// body: { fromClassName, toClassName: string | null }
// toClassName === null means "graduating" — students are deactivated
// instead of moved to a new class (used for 年長, which has no next grade).
// Moves/deactivates every currently-active student in fromClassName in one
// batched write.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromClassName, toClassName } = body ?? {};

  if (!fromClassName || (toClassName !== null && typeof toClassName !== "string")) {
    return NextResponse.json(
      { error: "Missing fromClassName, or invalid toClassName" },
      { status: 400 }
    );
  }

  try {
    const promoted = await promoteClassStudents(fromClassName, toClassName);
    return NextResponse.json({ promoted });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to promote class" }, { status: 500 });
  }
}
