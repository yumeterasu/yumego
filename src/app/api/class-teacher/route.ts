import { NextRequest, NextResponse } from "next/server";
import { getClassTeachers, getTeachers, setClassTeacher } from "@/lib/sheets";

// GET /api/class-teacher -> { assignments: [{ className, teacherId, teacherName }] }
// Joins in the teacher's current name server-side so callers (the top page
// in particular) don't need a second fetch just to display it.
export async function GET() {
  try {
    const [assignments, teachers] = await Promise.all([getClassTeachers(), getTeachers()]);
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));
    return NextResponse.json({
      assignments: assignments.map((a) => ({
        ...a,
        teacherName: nameById.get(a.teacherId) ?? "",
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class-teacher assignments" }, { status: 500 });
  }
}

// PATCH /api/class-teacher  { className, teacherId: string | null }
// teacherId: null unassigns the class (back to "no teacher set").
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, teacherId } = body ?? {};

  if (typeof className !== "string" || !className) {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }
  if (teacherId !== null && (typeof teacherId !== "string" || !teacherId)) {
    return NextResponse.json({ error: "Invalid teacherId" }, { status: 400 });
  }

  try {
    await setClassTeacher(className, teacherId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class teacher" }, { status: 500 });
  }
}
