import { NextRequest, NextResponse } from "next/server";
import { getStudentLocation, setStudentLocation } from "@/lib/sheets";

// Nominatim (OpenStreetMap) — free, no API key. Their usage policy requires
// a descriptive User-Agent identifying the app/contact, and asks for light,
// non-bulk use (this only ever geocodes one address at a time, triggered by
// an admin typing it in, so that's naturally respected).
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "YumegoPreschoolApp/1.0 (contact: ai-admin@yume-terasu.com)";

const SHORT_LINK_PATTERN = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/;

/** Follows a shortened Google Maps link server-side to its resolved URL. */
async function resolveShortLink(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; YumegoPreschoolApp/1.0)" },
      redirect: "follow",
    });
    return res.url || null;
  } catch {
    return null;
  }
}

/**
 * Recognizes GPS coordinates, in a few common forms an admin might copy
 * from Google Maps:
 *  - a plain "lat, lng" pair (right-click a pin -> click the coordinates
 *    that appear at the top to copy them)
 *  - a full (non-shortened) Google Maps URL containing "@lat,lng,zoom"
 *  - a Google Maps URL with a "q=lat,lng" or "ll=lat,lng" query param
 * Not anchored to the whole string, so it also matches when embedded in a
 * longer resolved short-link URL.
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

/** "/maps/place/My+Condo+Name/@..." -> "My Condo Name", when present. */
function extractPlaceName(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/@]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1].replace(/\+/g, " ");
  }
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
// address: null removes the saved location. Otherwise, tried in this order:
//  1. a shortened Google Maps link ("Copy link") -- resolved server-side,
//     then coordinates + place name extracted from the resolved URL
//  2. GPS coordinates pasted directly, or embedded in a full Maps URL
//  3. free-text address, forward-geocoded via Nominatim
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
    const shortLinkMatch = trimmed.match(SHORT_LINK_PATTERN);

    let workingInput = trimmed;
    if (shortLinkMatch) {
      const resolved = await resolveShortLink(shortLinkMatch[0]);
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              "リンクを開けませんでした。座標を直接コピーして貼り付けてください / Couldn't open the link — try copying the coordinates directly instead",
          },
          { status: 422 }
        );
      }
      workingInput = resolved;
    }

    const coords = extractCoordinates(workingInput);

    if (coords) {
      const placeName = extractPlaceName(workingInput);
      let displayName = placeName ?? "GPS座標 (pinned coordinates)";
      if (!placeName) {
        // Best-effort reverse geocode purely for a human-readable
        // confirmation name when the URL/coordinates didn't carry one --
        // the exact coordinates are what gets saved either way.
        try {
          const revUrl = `${NOMINATIM_REVERSE_URL}?lat=${coords.lat}&lon=${coords.lng}&format=json`;
          const revRes = await fetch(revUrl, { headers: { "User-Agent": USER_AGENT } });
          if (revRes.ok) {
            const revData = await revRes.json();
            if (revData?.display_name) displayName = revData.display_name;
          }
        } catch {
          // ignore -- fall back to the generic label above
        }
      }
      const resolvedAddress = placeName
        ? `${placeName} (${coords.lat}, ${coords.lng})`
        : `${coords.lat}, ${coords.lng}`;
      await setStudentLocation(studentId, { address: resolvedAddress, lat: coords.lat, lng: coords.lng });
      return NextResponse.json({
        ok: true,
        location: { studentId, address: resolvedAddress, lat: coords.lat, lng: coords.lng },
        displayName,
      });
    }

    if (shortLinkMatch) {
      // Resolved successfully but the resulting URL had no coordinates we
      // recognize (an unusual Maps link shape) -- don't fall through to
      // text-searching the raw link, that would never succeed usefully.
      return NextResponse.json(
        {
          error:
            "リンクから座標を取得できませんでした。座標を直接コピーして貼り付けてください / Couldn't find coordinates in that link — try copying the coordinates directly instead",
        },
        { status: 422 }
      );
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
