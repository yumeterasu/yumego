import { NextRequest, NextResponse } from "next/server";
import { getClassColors, setClassColor, setClassPlanet } from "@/lib/sheets";

const VALID_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose",
];

const VALID_PLANETS = [
  "sun", "mercury", "venus", "earth", "mars",
  "jupiter", "saturn", "uranus", "neptune", "pluto",
];

// GET /api/class-colors -> { colors: [{ className, color, planet }] }
export async function GET() {
  try {
    const colors = await getClassColors();
    return NextResponse.json({ colors });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class colors" }, { status: 500 });
  }
}

// PATCH /api/class-colors  { className, color?: string | null, planet?: string | null }
// color and planet are independent -- pass whichever one you're changing
// (null resets just that one back to default); the other, if present in
// the same call, is applied too, but neither is required to touch the
// other's existing value if omitted entirely.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, color, planet } = body ?? {};

  if (typeof className !== "string" || !className) {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }
  if (color === undefined && planet === undefined) {
    return NextResponse.json({ error: "Provide 'color' and/or 'planet'" }, { status: 400 });
  }
  if (color !== undefined && color !== null && !VALID_COLORS.includes(color)) {
    return NextResponse.json({ error: "Invalid color" }, { status: 400 });
  }
  if (planet !== undefined && planet !== null && !VALID_PLANETS.includes(planet)) {
    return NextResponse.json({ error: "Invalid planet" }, { status: 400 });
  }

  try {
    if (color !== undefined) await setClassColor(className, color);
    if (planet !== undefined) await setClassPlanet(className, planet);
    return NextResponse.json({ ok: true, color, planet });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class color/planet" }, { status: 500 });
  }
}
