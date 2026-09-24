import { NextRequest, NextResponse } from "next/server";

// OSRM public Trip API -- free, no API key, analogous to Google Directions'
// optimize:true. Same fair-use courtesy as the Nominatim calls in
// students/location/route.ts: descriptive User-Agent, light/non-bulk use
// (one request per manual "calculate route" click on the test page).
const OSRM_TRIP_URL = "https://router.project-osrm.org/trip/v1/driving";
const USER_AGENT = "YumegoPreschoolApp/1.0 (contact: ai-admin@yume-terasu.com)";

type Point = { lat: number; lng: number };

// POST /api/bus-route-test/optimize
// body: { points: { lat, lng }[] } -- visiting-candidate order; the first
// and last points are pinned as the trip's start/end (source=first,
// destination=last), everything between is free for OSRM to reorder.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const points: Point[] | undefined = body?.points;

  if (!Array.isArray(points) || points.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 points (a start and an end)" },
      { status: 400 }
    );
  }
  for (const p of points) {
    if (
      typeof p?.lat !== "number" ||
      typeof p?.lng !== "number" ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lng)
    ) {
      return NextResponse.json({ error: "Invalid point in points[]" }, { status: 400 });
    }
  }

  // OSRM wants "lng,lat" pairs, NOT "lat,lng" -- easy to get backwards.
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_TRIP_URL}/${coords}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `OSRM request failed (${res.status})` },
        { status: 502 }
      );
    }
    const data = await res.json();
    if (data.code !== "Ok" || !Array.isArray(data.trips) || data.trips.length === 0) {
      return NextResponse.json(
        { error: data.message || "OSRM couldn't find a route for these points" },
        { status: 422 }
      );
    }

    const trip = data.trips[0];
    // data.waypoints[i].waypoint_index gives the position of input point i
    // within the optimized visiting order.
    const order: number[] = (data.waypoints ?? [])
      .map((w: { waypoint_index: number }, inputIndex: number) => ({
        inputIndex,
        visitPosition: w.waypoint_index,
      }))
      .sort((a: { visitPosition: number }, b: { visitPosition: number }) => a.visitPosition - b.visitPosition)
      .map((w: { inputIndex: number }) => w.inputIndex);

    const legs = (trip.legs ?? []).map((leg: { distance: number; duration: number }) => ({
      distance: leg.distance,
      duration: leg.duration,
    }));

    return NextResponse.json({
      order,
      legs,
      geometry: trip.geometry,
      totalDistance: trip.distance,
      totalDuration: trip.duration,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to reach OSRM" }, { status: 502 });
  }
}
