import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getExtraClasses, addExtraClass, updateExtraClass, deleteExtraClass } from "@/lib/sheets";

// GET /api/extra-classes
// Every extra class, active and inactive — the Master settings page needs
// to show inactive ones too (so they can be reactivated). Consumers that
// only want the live top-page list filter to active === true themselves.
export async function GET() {
  try {
    const classes = await getExtraClasses();
    return NextResponse.json({ classes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch extra classes" }, { status: 500 });
  }
}

// POST /api/extra-classes  { branch, suffix, nameEn }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branch, suffix, nameEn } = body ?? {};

  if (
    (branch !== "プロンポン" && branch !== "トンロー") ||
    typeof suffix !== "string" ||
    !suffix.trim() ||
    typeof nameEn !== "string"
  ) {
    return NextResponse.json({ error: "Missing or invalid branch/suffix/nameEn" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addExtraClass(id, { branch, suffix: suffix.trim(), nameEn: nameEn.trim(), active: true });
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add extra class" }, { status: 500 });
  }
}

// PATCH /api/extra-classes  { id, suffix?, nameEn?, active? }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, suffix, nameEn, active } = body ?? {};

  if (
    typeof id !== "string" ||
    !id ||
    (suffix !== undefined && (typeof suffix !== "string" || !suffix.trim())) ||
    (nameEn !== undefined && typeof nameEn !== "string") ||
    (active !== undefined && typeof active !== "boolean")
  ) {
    return NextResponse.json({ error: "Missing or invalid id/suffix/nameEn/active" }, { status: 400 });
  }

  try {
    await updateExtraClass(id, {
      suffix: suffix?.trim(),
      nameEn: nameEn?.trim(),
      active,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update extra class" }, { status: 500 });
  }
}

// DELETE /api/extra-classes?id=...
// Only allowed once the class is already inactive -- deleteExtraClass()
// throws otherwise, enforcing deactivate-first-then-delete.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteExtraClass(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to delete extra class";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
