import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getOutingLogs,
  addOutingLog,
  updateOutingLog,
  deleteOutingLog,
} from "@/lib/sheets";

// GET /api/outings?class=プロンポン　年長&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const month = req.nextUrl.searchParams.get("month");

  if (!className || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const entries = await getOutingLogs(className, month);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch outings" }, { status: 500 });
  }
}

type Payload = {
  date?: unknown;
  className?: unknown;
  headcount?: unknown;
  departureTime?: unknown;
  returnTime?: unknown;
  description?: unknown;
};

function validatePayload(body: Payload) {
  const { date, className, headcount, departureTime, returnTime, description } = body;
  if (
    typeof date !== "string" ||
    typeof className !== "string" ||
    typeof headcount !== "number" ||
    !Number.isFinite(headcount) ||
    headcount < 0 ||
    typeof departureTime !== "string" ||
    typeof returnTime !== "string" ||
    typeof description !== "string"
  ) {
    return null;
  }
  return {
    date,
    className,
    headcount: Math.floor(headcount),
    departureTime,
    returnTime,
    description,
  };
}

// POST /api/outings  { date, className, headcount, departureTime, returnTime, description }
export async function POST(req: NextRequest) {
  const body = (await req.json()) ?? {};
  const fields = validatePayload(body);
  if (!fields) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  try {
    const id = randomUUID();
    await addOutingLog({ id, ...fields });
    return NextResponse.json({ id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add outing" }, { status: 500 });
  }
}

// PATCH /api/outings  { id, date, className, headcount, departureTime, returnTime, description }
export async function PATCH(req: NextRequest) {
  const body = (await req.json()) ?? {};
  const { id } = body;
  const fields = validatePayload(body);
  if (typeof id !== "string" || !id || !fields) {
    return NextResponse.json({ error: "Missing id or invalid fields" }, { status: 400 });
  }

  try {
    await updateOutingLog(id, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update outing" }, { status: 500 });
  }
}

// DELETE /api/outings?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing 'id' query param" }, { status: 400 });
  }

  try {
    await deleteOutingLog(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete outing" }, { status: 500 });
  }
}
