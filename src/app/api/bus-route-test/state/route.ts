import { NextRequest, NextResponse } from "next/server";
import { getBusRouteTestState, setBusRouteTestState } from "@/lib/sheets";

// GET /api/bus-route-test/state -> { state: <whatever was last saved> | null }
export async function GET() {
  try {
    const json = await getBusRouteTestState();
    return NextResponse.json({ state: json ? JSON.parse(json) : null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load state" }, { status: 500 });
  }
}

// PUT /api/bus-route-test/state  body: <the whole mock state object>
// Last write wins -- fine for a single-tester prototype page.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    await setBusRouteTestState(JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save state" }, { status: 500 });
  }
}
