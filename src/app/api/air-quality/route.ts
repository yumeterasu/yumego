import { NextResponse } from "next/server";

// Roughly central Bangkok (Watthana district) -- プロンポン and トンロー are
// only a few km apart, so one shared reading for both branches is close
// enough rather than querying two near-identical points separately.
const BANGKOK_LAT = 13.7563;
const BANGKOK_LON = 100.5018;

// Open-Meteo's Air Quality API -- free, no API key/signup required (CC-BY
// 4.0 licensed data), confirmed live at
// https://air-quality-api.open-meteo.com/v1/air-quality.
export const revalidate = 1800; // 30 min -- PM2.5 readings don't change fast
// enough to justify hitting the external API on every single page load;
// Next's fetch cache (below) does the actual caching, this just documents it.

export async function GET() {
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${BANGKOK_LAT}&longitude=${BANGKOK_LON}&current=pm2_5&timezone=Asia%2FBangkok`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const data = await res.json();
    const pm25 = data.current?.pm2_5;
    if (typeof pm25 !== "number") throw new Error("Missing pm2_5 in response");

    return NextResponse.json({
      pm25: Math.round(pm25),
      updatedAt: data.current?.time ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch air quality" }, { status: 502 });
  }
}
