import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getAbsenceReasons,
  addAbsenceReason,
  updateAbsenceReason,
  deleteAbsenceReason,
} from "@/lib/sheets";

// GET /api/absence-reasons
// School-wide list (not scoped to a class/branch) — every device sees the
// same quick-pick options.
export async function GET() {
  try {
    const reasons = await getAbsenceReasons();
    return NextResponse.json({ reasons });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch absence reasons" }, { status: 500 });
  }
}

// POST /api/absence-reasons  { label, en, status: "absent" | "suspended" }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { label, en, status } = body ?? {};

  if (
    typeof label !== "string" ||
    !label.trim() ||
    typeof en !== "string" ||
    (status !== "absent" && status !== "suspended")
  ) {
    return NextResponse.json({ error: "Missing or invalid label/en/status" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addAbsenceReason(id, { label: label.trim(), en: en.trim(), status });
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add absence reason" }, { status: 500 });
  }
}

// PATCH /api/absence-reasons  { id, label?, en?, status? }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, label, en, status } = body ?? {};

  if (
    typeof id !== "string" ||
    !id ||
    (label !== undefined && typeof label !== "string") ||
    (en !== undefined && typeof en !== "string") ||
    (status !== undefined && status !== "absent" && status !== "suspended")
  ) {
    return NextResponse.json({ error: "Missing or invalid id/label/en/status" }, { status: 400 });
  }

  try {
    await updateAbsenceReason(id, { label, en, status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update absence reason" }, { status: 500 });
  }
}

// DELETE /api/absence-reasons?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteAbsenceReason(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete absence reason" }, { status: 500 });
  }
}
