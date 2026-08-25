import { NextRequest, NextResponse } from "next/server";
import { getStudentLocation, setStudentLocation } from "@/lib/sheets";

// Nominatim (OpenStreetMap) — free, no API key. Their usage policy requires
// a descriptive User-Agent identifying the app/contact, and asks for light,
// non-bulk use (this only ever geocodes one address at a time, triggered by
// an admin typing it in, so that's naturally respected).
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "YumegoPreschoolApp/1.0 (contact: ai-admin@yume-terasu.com)";

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
// address: null removes the saved location. Otherwise, geocodes the address
// via Nominatim and stores the result.
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

    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address.trim())}&format=json&limit=1`;
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
    const resolvedAddress = address.trim();
    await setStudentLocation(studentId, { address: resolvedAddress, lat, lng });
    return NextResponse.json({
      ok: true,
      location: { studentId, address: resolvedAddress, lat, lng },
      displayName: results[0].display_name as string,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 });
  }
}
