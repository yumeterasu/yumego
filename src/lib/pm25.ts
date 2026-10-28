// Thailand PCD-style PM2.5 severity scale (µg/m3) shared by the Top page's
// indicator and its API route — breakpoints are illustrative/approximate,
// not an authoritative copy of the PCD's own published thresholds.
export type Pm25Level = {
  max: number;
  labelJa: string;
  labelEn: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
};

export const PM25_LEVELS: Pm25Level[] = [
  {
    max: 25,
    labelJa: "非常に良い",
    labelEn: "Very Good",
    textClass: "text-blue-700",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-200",
    dotClass: "bg-blue-500",
  },
  {
    max: 37,
    labelJa: "良い",
    labelEn: "Good",
    textClass: "text-green-700",
    bgClass: "bg-green-50",
    borderClass: "border-green-200",
    dotClass: "bg-green-500",
  },
  {
    max: 50,
    labelJa: "普通",
    labelEn: "Moderate",
    textClass: "text-yellow-700",
    bgClass: "bg-yellow-50",
    borderClass: "border-yellow-200",
    dotClass: "bg-yellow-500",
  },
  {
    max: 90,
    labelJa: "要注意",
    labelEn: "Unhealthy (Sensitive)",
    textClass: "text-orange-700",
    bgClass: "bg-orange-50",
    borderClass: "border-orange-200",
    dotClass: "bg-orange-500",
  },
  {
    max: Infinity,
    labelJa: "健康に影響",
    labelEn: "Unhealthy",
    textClass: "text-red-700",
    bgClass: "bg-red-50",
    borderClass: "border-red-200",
    dotClass: "bg-red-500",
  },
];

export function pm25Level(pm25: number): Pm25Level {
  return PM25_LEVELS.find((l) => pm25 <= l.max) ?? PM25_LEVELS[PM25_LEVELS.length - 1];
}
