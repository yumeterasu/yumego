import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTeachers, addTeacher, updateTeacher, deleteTeacher } from "@/lib/sheets";

// GET /api/teachers
export async function GET() {
  try {
    const teachers = await getTeachers();
    return NextResponse.json({ teachers });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch teachers" }, { status: 500 });
  }
}

// POST /api/teachers  { name }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name } = body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addTeacher(id, name.trim());
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add teacher" }, { status: 500 });
  }
}

// PATCH /api/teachers  { id, name }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name } = body ?? {};

  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing or invalid id/name" }, { status: 400 });
  }

  try {
    await updateTeacher(id, name.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update teacher" }, { status: 500 });
  }
}

// DELETE /api/teachers?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteTeacher(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete teacher" }, { status: 500 });
  }
}
