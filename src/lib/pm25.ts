// Thailand PCD's own 5-band AQI severity scale -- indexed by the
// "color_id" (1-5) that Air4Thai's API already assigns to each reading, so
// this mirrors the PCD's official categorization exactly rather than
// re-deriving breakpoints from the raw PM2.5 concentration ourselves.
export type Pm25Level = {
  labelJa: string;
  labelEn: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
};

export const AQI_LEVELS_BY_COLOR_ID: Record<number, Pm25Level> = {
  1: {
    labelJa: "非常に良い",
    labelEn: "Very Good",
    textClass: "text-blue-700",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-200",
    dotClass: "bg-blue-500",
  },
  2: {
    labelJa: "良い",
    labelEn: "Good",
    textClass: "text-green-700",
    bgClass: "bg-green-50",
    borderClass: "border-green-200",
    dotClass: "bg-green-500",
  },
  3: {
    labelJa: "普通",
    labelEn: "Moderate",
    textClass: "text-yellow-700",
    bgClass: "bg-yellow-50",
    borderClass: "border-yellow-200",
    dotClass: "bg-yellow-500",
  },
  4: {
    labelJa: "要注意",
    labelEn: "Unhealthy (Sensitive)",
    textClass: "text-orange-700",
    bgClass: "bg-orange-50",
    borderClass: "border-orange-200",
    dotClass: "bg-orange-500",
  },
  5: {
    labelJa: "健康に影響",
    labelEn: "Unhealthy",
    textClass: "text-red-700",
    bgClass: "bg-red-50",
    borderClass: "border-red-200",
    dotClass: "bg-red-500",
  },
};

const FALLBACK_LEVEL = AQI_LEVELS_BY_COLOR_ID[5];

export function aqiLevel(colorId: number): Pm25Level {
  return AQI_LEVELS_BY_COLOR_ID[colorId] ?? FALLBACK_LEVEL;
}
