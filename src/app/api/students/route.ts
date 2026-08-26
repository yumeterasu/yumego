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
  CheckColumn,
} from "@/lib/sheets";
import { randomUUID } from "crypto";

const CHECK_COLUMNS: CheckColumn[] = ["check1", "check2", "check3"];

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

// POST /api/students  { nameKanji, nameEnglish, className }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nameKanji, nameEnglish, className } = body ?? {};

  if (!nameKanji || !className) {
    return NextResponse.json(
      { error: "Missing nameKanji or className" },
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
// or { studentId, nameKanji, nameEnglish? } to correct a student's name --
// takes effect everywhere the name is shown, since it's all read live from
// this same row.
// or { studentId, moveToClassName } to transfer a student to a different
// class -- see updateStudentClass() for exactly what this does and doesn't
// touch (historical records stay put; StudentLocations/Transport/PickupLog
// already follow the student automatically).
// column is one of "check1"/"check2"/"check3", value is boolean.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, remark, column, value, active, nameKanji, nameEnglish, moveToClassName } =
    body ?? {};

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
      await updateStudentName(studentId, nameKanji.trim(), (nameEnglish ?? "").trim());
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
      { error: "Missing remark, column/value, active, nameKanji, or moveToClassName" },
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
