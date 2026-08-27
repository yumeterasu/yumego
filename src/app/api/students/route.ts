import { NextRequest, NextResponse } from "next/server";
import {
  addStudent,
  getStudentsByClass,
  getAllStudentsByClass,
  updateStudentName,
  updateStudentClass,
  updateStudentRemark,
  updateStudentCheck,
  setStudentActive,
  deleteStudentPermanently,
  CheckColumn,
} from "@/lib/sheets";
import { randomUUID } from "crypto";

const CHECK_COLUMNS: CheckColumn[] = ["check1", "check2", "check3"];
const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/students?class=プロンポン　年長[&includeInactive=true]
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";

  if (!className) {
    return NextResponse.json(
      { error: "Missing 'class' query param" },
      { status: 400 }
    );
  }

  try {
    const students = includeInactive
      ? await getAllStudentsByClass(className)
      : await getStudentsByClass(className);
    return NextResponse.json({ students });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch students" },
      { status: 500 }
    );
  }
}

// POST /api/students  { nameKanji, nameEnglish, className, birthDate? }
// birthDate, if given, must be "YYYY-MM-DD".
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nameKanji, nameEnglish, className, birthDate } = body ?? {};

  if (!nameKanji || !className) {
    return NextResponse.json(
      { error: "Missing nameKanji or className" },
      { status: 400 }
    );
  }
  if (birthDate && !BIRTH_DATE_RE.test(birthDate)) {
    return NextResponse.json(
      { error: "birthDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const studentId = randomUUID();
    await addStudent({
      studentId,
      nameKanji,
      nameEnglish: nameEnglish ?? "",
      className,
      birthDate: birthDate ?? "",
    });
    return NextResponse.json({ studentId });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to add student" },
      { status: 500 }
    );
  }
}

// PATCH /api/students  { studentId, remark? } or { studentId, column, value }
// or { studentId, active } to withdraw/graduate (false) or restore (true)
// or { studentId, nameKanji, nameEnglish?, nameHiragana?, birthDate? } to
// correct a student's name/birth date -- takes effect everywhere it's
// shown, since it's all read live from this same row. birthDate, if given
// and non-empty, must be "YYYY-MM-DD"; pass "" to clear it.
// or { studentId, moveToClassName } to transfer a student to a different
// class -- see updateStudentClass() for exactly what this does and doesn't
// touch (historical records stay put; StudentLocations/Transport/PickupLog
// already follow the student automatically).
// (Reordering the roster is a separate endpoint -- see
// POST /api/students/reorder.)
// column is one of "check1"/"check2"/"check3", value is boolean.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const {
    studentId,
    remark,
    column,
    value,
    active,
    nameKanji,
    nameEnglish,
    nameHiragana,
    birthDate,
    moveToClassName,
  } = body ?? {};

  if (!studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }

  try {
    if (typeof moveToClassName === "string") {
      if (!moveToClassName.trim()) {
        return NextResponse.json({ error: "moveToClassName cannot be empty" }, { status: 400 });
      }
      await updateStudentClass(studentId, moveToClassName.trim());
      return NextResponse.json({ ok: true });
    }

    if (typeof nameKanji === "string") {
      if (!nameKanji.trim()) {
        return NextResponse.json({ error: "nameKanji cannot be empty" }, { status: 400 });
      }
      const trimmedBirthDate = (birthDate ?? "").trim();
      if (trimmedBirthDate && !BIRTH_DATE_RE.test(trimmedBirthDate)) {
        return NextResponse.json({ error: "birthDate must be YYYY-MM-DD" }, { status: 400 });
      }
      await updateStudentName(
        studentId,
        nameKanji.trim(),
        (nameEnglish ?? "").trim(),
        (nameHiragana ?? "").trim(),
        trimmedBirthDate
      );
      return NextResponse.json({ ok: true });
    }

    if (typeof remark === "string") {
      await updateStudentRemark(studentId, remark);
      return NextResponse.json({ ok: true });
    }

    if (
      typeof column === "string" &&
      CHECK_COLUMNS.includes(column as CheckColumn) &&
      typeof value === "boolean"
    ) {
      await updateStudentCheck(studentId, column as CheckColumn, value);
      return NextResponse.json({ ok: true });
    }

    if (typeof active === "boolean") {
      await setStudentActive(studentId, active);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      {
        error: "Missing remark, column/value, active, nameKanji, or moveToClassName",
      },
      { status: 400 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update student" },
      { status: 500 }
    );
  }
}

// DELETE /api/students?studentId=...
// Permanently removes one already-withdrawn student -- NOT recoverable.
// Only allowed once inactive; deleteStudentPermanently() throws otherwise,
// enforcing withdraw-first-then-delete (same funnel as extra classes).
export async function DELETE(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "Missing 'studentId' query param" }, { status: 400 });
  }

  try {
    await deleteStudentPermanently(studentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to delete student";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
