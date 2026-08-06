import { NextRequest, NextResponse } from "next/server";
import {
  addStudent,
  getStudentsByClass,
  updateStudentRemark,
} from "@/lib/sheets";
import { randomUUID } from "crypto";

// GET /api/students?class=プロンポン　年長
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");

  if (!className) {
    return NextResponse.json(
      { error: "Missing 'class' query param" },
      { status: 400 }
    );
  }

  try {
    const students = await getStudentsByClass(className);
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

// PATCH /api/students  { studentId, remark }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, remark } = body ?? {};

  if (!studentId || typeof remark !== "string") {
    return NextResponse.json(
      { error: "Missing studentId or remark" },
      { status: 400 }
    );
  }

  try {
    await updateStudentRemark(studentId, remark);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update remark" },
      { status: 500 }
    );
  }
}
