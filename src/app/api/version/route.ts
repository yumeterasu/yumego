import { NextResponse } from "next/server";

// GET /api/version -> { version }
// Reads the currently-RUNNING deploy's own commit SHA (Vercel sets this
// automatically), so it flips the instant a new deploy finishes -- unlike
// the client's own build-time NEXT_PUBLIC_APP_VERSION, which stays fixed
// at whatever was baked into the JS bundle the browser already has
// loaded. VersionWatcher polls this to notice the two have drifted apart.
export async function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
