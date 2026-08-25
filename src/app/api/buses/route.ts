import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getBuses, addBus, updateBus, deleteBus } from "@/lib/sheets";

// GET /api/buses
export async function GET() {
  try {
    const buses = await getBuses();
    return NextResponse.json({ buses });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch buses" }, { status: 500 });
  }
}

// POST /api/buses  { name, emoji? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, emoji } = body ?? {};

  if (typeof name !== "string" || !name.trim() || (emoji !== undefined && typeof emoji !== "string")) {
    return NextResponse.json({ error: "Missing or invalid name/emoji" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addBus(id, { name: name.trim(), emoji: (emoji ?? "").trim() });
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add bus" }, { status: 500 });
  }
}

// PATCH /api/buses  { id, name?, emoji? }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, emoji } = body ?? {};

  if (
    typeof id !== "string" ||
    !id ||
    (name !== undefined && (typeof name !== "string" || !name.trim())) ||
    (emoji !== undefined && typeof emoji !== "string")
  ) {
    return NextResponse.json({ error: "Missing or invalid id/name/emoji" }, { status: 400 });
  }

  try {
    await updateBus(id, { name: name?.trim(), emoji: emoji?.trim() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update bus" }, { status: 500 });
  }
}

// DELETE /api/buses?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteBus(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete bus" }, { status: 500 });
  }
}
