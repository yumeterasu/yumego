import { NextRequest, NextResponse } from "next/server";
import { addStudentsBulk } from "@/lib/sheets";
import { randomUUID } from "crypto";

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/students/bulk
// body: { className, students: [{ nameKanji, nameEnglish?, birthDate? }, ...] }
// Adds many students in one request (one Sheets append call), for
// registering a whole new intake at once instead of one at a time.
// birthDate, if given, must be "YYYY-MM-DD" -- a malformed one is dropped
// (that student is still added, just without a birth date) rather than
// failing the whole batch, since the client-side preview is meant to
// catch this before submitting at all.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { className, students } = body ?? {};

  if (!className || !Array.isArray(students) || students.length === 0) {
    return NextResponse.json(
      { error: "Missing className or students" },
      { status: 400 }
    );
  }

  const rows: { nameKanji: unknown; nameEnglish?: unknown; birthDate?: unknown }[] = students;
  const cleaned: {
    studentId: string;
    nameKanji: string;
    nameEnglish: string;
    className: string;
    birthDate: string;
  }[] = [];
  for (const r of rows) {
    if (typeof r?.nameKanji !== "string" || !r.nameKanji.trim()) continue;
    const rawBirthDate = typeof r.birthDate === "string" ? r.birthDate.trim() : "";
    cleaned.push({
      studentId: randomUUID(),
      nameKanji: r.nameKanji.trim(),
      nameEnglish: typeof r.nameEnglish === "string" ? r.nameEnglish.trim() : "",
      className,
      birthDate: BIRTH_DATE_RE.test(rawBirthDate) ? rawBirthDate : "",
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
