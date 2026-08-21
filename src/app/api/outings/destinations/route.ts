import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getOutingDestinations,
  addOutingDestination,
  deleteOutingDestination,
} from "@/lib/sheets";

// GET /api/outings/destinations
// School-wide list (not scoped to a branch/class) — every device sees the
// same options.
export async function GET() {
  try {
    const destinations = await getOutingDestinations();
    return NextResponse.json({ destinations });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch destinations" }, { status: 500 });
  }
}

// POST /api/outings/destinations  { name }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name } = body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addOutingDestination(id, name.trim());
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add destination" }, { status: 500 });
  }
}

// DELETE /api/outings/destinations?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteOutingDestination(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete destination" }, { status: 500 });
  }
}
