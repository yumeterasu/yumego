import { NextRequest, NextResponse } from "next/server";
import { getClassColors, setClassColor } from "@/lib/sheets";

const VALID_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose",
];

// GET /api/class-colors -> { colors: [...] }
export async function GET() {
  try {
    const colors = await getClassColors();
    return NextResponse.json({ colors });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class colors" }, { status: 500 });
  }
}

// PATCH /api/class-colors  { className, color: string | null }
// color: null resets to the default (no color chosen).
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, color } = body ?? {};

  if (typeof className !== "string" || !className) {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }
  if (color !== null && !VALID_COLORS.includes(color)) {
    return NextResponse.json({ error: "Invalid color" }, { status: 400 });
  }

  try {
    await setClassColor(className, color);
    return NextResponse.json({ ok: true, color });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class color" }, { status: 500 });
  }
}
