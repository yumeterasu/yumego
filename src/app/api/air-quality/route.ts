import { NextResponse } from "next/server";

// Pollution Control Department's Air4Thai network -- free, no API key, and
// (unlike the Open-Meteo model-based estimate this replaced) a real ground
// station. "bkp70t" (Soi Sukhumwit 63, Wattana) is the closest station to
// プロンポン/トンロー -- both branches are only ~1-2km from it, so one shared
// reading is close enough rather than querying per-branch.
const STATION_ID = "bkp70t";

export const revalidate = 1800; // 30 min -- PM2.5 readings don't change fast
// enough to justify hitting the external API on every single page load;
// Next's fetch cache (below) does the actual caching, this just documents it.
// (Air4Thai itself only refreshes readings hourly, so this is conservative.)

export async function GET() {
  try {
    const res = await fetch("https://air4thai.pcd.go.th/services/getNewAQI_JSON.php", {
      next: { revalidate: 1800 },
    });
    if (!res.ok) throw new Error(`Air4Thai responded ${res.status}`);
    const data = await res.json();
    const station = (data.stations as Array<Record<string, unknown>>)?.find(
      (s) => s.stationID === STATION_ID
    );
    const pm25 = (station?.AQILast as Record<string, unknown>)?.PM25 as
      | { aqi?: string; value?: string; color_id?: string }
      | undefined;
    const aqi = pm25?.aqi !== undefined ? Number(pm25.aqi) : NaN;
    if (!station || Number.isNaN(aqi) || aqi < 0) throw new Error("Missing PM2.5 AQI in response");

    const aqiLast = station.AQILast as { date?: string; time?: string };
    return NextResponse.json({
      aqi,
      colorId: pm25?.color_id !== undefined ? Number(pm25.color_id) : null,
      pm25: pm25?.value !== undefined ? Number(pm25.value) : null,
      area: station.areaEN ?? null,
      updatedAt:
        aqiLast.date && aqiLast.time ? `${aqiLast.date}T${aqiLast.time}:00+07:00` : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch air quality" }, { status: 502 });
  }
}
