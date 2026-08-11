import { NextRequest, NextResponse } from "next/server";
import { addStudentsBulk } from "@/lib/sheets";
import { randomUUID } from "crypto";

// POST /api/students/bulk
// body: { className, students: [{ nameKanji, nameEnglish? }, ...] }
// Adds many students in one request (one Sheets append call), for
// registering a whole new intake at once instead of one at a time.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { className, students } = body ?? {};

  if (!className || !Array.isArray(students) || students.length === 0) {
    return NextResponse.json(
      { error: "Missing className or students" },
      { status: 400 }
    );
  }

  const rows: { nameKanji: unknown; nameEnglish?: unknown }[] = students;
  const cleaned: { studentId: string; nameKanji: string; nameEnglish: string; className: string }[] =
    [];
  for (const r of rows) {
    if (typeof r?.nameKanji !== "string" || !r.nameKanji.trim()) continue;
    cleaned.push({
      studentId: randomUUID(),
      nameKanji: r.nameKanji.trim(),
      nameEnglish: typeof r.nameEnglish === "string" ? r.nameEnglish.trim() : "",
      className,
    });
  }

  if (cleaned.length === 0) {
    return NextResponse.json({ error: "No valid names to add" }, { status: 400 });
  }

  try {
    await addStudentsBulk(cleaned);
    return NextResponse.json({ added: cleaned.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add students" }, { status: 500 });
  }
}
