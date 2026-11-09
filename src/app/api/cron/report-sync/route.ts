import { NextRequest, NextResponse } from "next/server";
import { syncReport } from "@/lib/reportSheets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/cron/report-sync
// Called by a scheduled GitHub Actions workflow (not Vercel Cron -- the
// Hobby plan's Cron feature only fires once a day, too infrequent for the
// requested 5-15 min refresh). This path is allowlisted in src/proxy.ts's
// PUBLIC_PATHS since GitHub Actions has no browser session/cookie to pass
// the site-wide password gate -- it's protected here instead by a bearer
// secret, which is never exposed to a browser.
export async function POST(req: NextRequest) {
  const secret = process.env.REPORT_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "REPORT_SYNC_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncReport();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
