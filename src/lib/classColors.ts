// Curated palette for per-class button colors (top page). Tailwind's
// build-time scanner needs literal class name strings in the source to
// generate their CSS, so these live as a fixed lookup table rather than
// being interpolated from a free color value fetched at runtime.

export const CLASS_COLOR_OPTIONS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose",
] as const;

export type ClassColorKey = (typeof CLASS_COLOR_OPTIONS)[number];

/** Card-style button (top page class buttons): border + background + hover. */
export const CLASS_COLOR_CARD_STYLES: Record<ClassColorKey, string> = {
  red: "border-red-300 bg-red-50 hover:bg-red-100",
  orange: "border-orange-300 bg-orange-50 hover:bg-orange-100",
  amber: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  yellow: "border-yellow-300 bg-yellow-50 hover:bg-yellow-100",
  lime: "border-lime-300 bg-lime-50 hover:bg-lime-100",
  green: "border-green-300 bg-green-50 hover:bg-green-100",
  emerald: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100",
  teal: "border-teal-300 bg-teal-50 hover:bg-teal-100",
  cyan: "border-cyan-300 bg-cyan-50 hover:bg-cyan-100",
  sky: "border-sky-300 bg-sky-50 hover:bg-sky-100",
  blue: "border-blue-300 bg-blue-50 hover:bg-blue-100",
  indigo: "border-indigo-300 bg-indigo-50 hover:bg-indigo-100",
  violet: "border-violet-300 bg-violet-50 hover:bg-violet-100",
  purple: "border-purple-300 bg-purple-50 hover:bg-purple-100",
  pink: "border-pink-300 bg-pink-50 hover:bg-pink-100",
  rose: "border-rose-300 bg-rose-50 hover:bg-rose-100",
};

export const CLASS_COLOR_DEFAULT_CARD_STYLE = "border-gray-300 hover:bg-gray-100";

/** Small solid swatch (for the color-picker grid itself). */
export const CLASS_COLOR_SWATCH_STYLES: Record<ClassColorKey, string> = {
  red: "bg-red-400",
  orange: "bg-orange-400",
  amber: "bg-amber-400",
  yellow: "bg-yellow-400",
  lime: "bg-lime-400",
  green: "bg-green-400",
  emerald: "bg-emerald-400",
  teal: "bg-teal-400",
  cyan: "bg-cyan-400",
  sky: "bg-sky-400",
  blue: "bg-blue-400",
  indigo: "bg-indigo-400",
  violet: "bg-violet-400",
  purple: "bg-purple-400",
  pink: "bg-pink-400",
  rose: "bg-rose-400",
};

export function isClassColorKey(value: string): value is ClassColorKey {
  return (CLASS_COLOR_OPTIONS as readonly string[]).includes(value);
}
