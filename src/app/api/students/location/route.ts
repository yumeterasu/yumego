import { NextRequest, NextResponse } from "next/server";
import { getStudentLocation, setStudentLocation } from "@/lib/sheets";

// Nominatim (OpenStreetMap) — free, no API key. Their usage policy requires
// a descriptive User-Agent identifying the app/contact, and asks for light,
// non-bulk use (this only ever geocodes one address at a time, triggered by
// an admin typing it in, so that's naturally respected).
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "YumegoPreschoolApp/1.0 (contact: ai-admin@yume-terasu.com)";

/**
 * Recognizes GPS coordinates pasted directly (most precise — no search
 * ambiguity), in a few common forms an admin might copy from Google Maps:
 *  - a plain "lat, lng" pair (what you get right-clicking a pin -> copying
 *    the coordinates that appear at the top)
 *  - a full (non-shortened) Google Maps URL containing "@lat,lng,zoom"
 *  - a Google Maps URL with a "q=lat,lng" or "ll=lat,lng" query param
 * Returns null (falling back to text search) for anything else, including
 * shortened maps.app.goo.gl links, which don't carry coordinates in the URL
 * itself.
 */
function extractCoordinates(input: string): { lat: number; lng: number } | null {
  const patterns = [
    /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const m = input.match(pattern);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

// GET /api/students/location?studentId=...
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "Missing 'studentId' query param" }, { status: 400 });
  }
  try {
    const location = await getStudentLocation(studentId);
    return NextResponse.json({ location });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch location" }, { status: 500 });
  }
}

// PATCH /api/students/location  { studentId, address: string | null }
// address: null removes the saved location. Otherwise: if it looks like GPS
// coordinates (or a Google Maps URL/copy-paste containing them), those are
// used directly -- most precise, no search involved. Otherwise it's treated
// as free-text and forward-geocoded via Nominatim.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, address } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (address !== null && (typeof address !== "string" || !address.trim())) {
    return NextResponse.json({ error: "Missing or invalid address" }, { status: 400 });
  }

  try {
    if (address === null) {
      await setStudentLocation(studentId, null);
      return NextResponse.json({ ok: true, location: null });
    }

    const trimmed = address.trim();
    const coords = extractCoordinates(trimmed);

    if (coords) {
      // Reverse-geocode is best-effort, purely for a human-readable
      // confirmation name -- the exact pasted coordinates are what gets
      // saved either way, never the reverse-lookup's approximate center.
      let displayName = "GPS座標 (pinned coordinates)";
      try {
        const revUrl = `${NOMINATIM_REVERSE_URL}?lat=${coords.lat}&lon=${coords.lng}&format=json`;
        const revRes = await fetch(revUrl, { headers: { "User-Agent": USER_AGENT } });
        if (revRes.ok) {
          const revData = await revRes.json();
          if (revData?.display_name) displayName = revData.display_name;
        }
      } catch {
        // reverse lookup failing doesn't block saving the exact coordinates
      }
      const resolvedAddress = `${coords.lat}, ${coords.lng}`;
      await setStudentLocation(studentId, { address: resolvedAddress, lat: coords.lat, lng: coords.lng });
      return NextResponse.json({
        ok: true,
        location: { studentId, address: resolvedAddress, lat: coords.lat, lng: coords.lng },
        displayName,
      });
    }

    const url = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(trimmed)}&format=json&limit=1`;
    const geoRes = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!geoRes.ok) {
      return NextResponse.json({ error: "Geocoding service unavailable" }, { status: 502 });
    }
    const results = await geoRes.json();
    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json(
        { error: "住所が見つかりませんでした / Address not found" },
        { status: 404 }
      );
    }

    const lat = Number(results[0].lat);
    const lng = Number(results[0].lon);
    await setStudentLocation(studentId, { address: trimmed, lat, lng });
    return NextResponse.json({
      ok: true,
      location: { studentId, address: trimmed, lat, lng },
      displayName: results[0].display_name as string,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 });
  }
}
