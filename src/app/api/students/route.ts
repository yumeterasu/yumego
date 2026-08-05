import { NextRequest, NextResponse } from "next/server";
import { addStudent, getStudentsByClass } from "@/lib/sheets";
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

// POST /api/students  { nameKanji, nameFurigana, className }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nameKanji, nameFurigana, className } = body ?? {};

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
      nameFurigana: nameFurigana ?? "",
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
