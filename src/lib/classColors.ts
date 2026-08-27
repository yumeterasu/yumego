// Curated palette for per-class button colors (top page). Tailwind's
// build-time scanner needs literal class name strings in the source to
// generate their CSS, so these live as a fixed lookup table rather than
// being interpolated from a free color value fetched at runtime.

export const CLASS_COLOR_OPTIONS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose",
] as const;

export type ClassColorKey = (typeof CLASS_COLOR_OPTIONS)[number];

/** Card-style button (top page class buttons): border + background + hover + text. */
export const CLASS_COLOR_CARD_STYLES: Record<ClassColorKey, string> = {
  red: "border-red-400 bg-red-200 hover:bg-red-300 text-red-900",
  orange: "border-orange-400 bg-orange-200 hover:bg-orange-300 text-orange-900",
  amber: "border-amber-400 bg-amber-200 hover:bg-amber-300 text-amber-900",
  yellow: "border-yellow-400 bg-yellow-200 hover:bg-yellow-300 text-yellow-900",
  lime: "border-lime-400 bg-lime-200 hover:bg-lime-300 text-lime-900",
  green: "border-green-400 bg-green-200 hover:bg-green-300 text-green-900",
  emerald: "border-emerald-400 bg-emerald-200 hover:bg-emerald-300 text-emerald-900",
  teal: "border-teal-400 bg-teal-200 hover:bg-teal-300 text-teal-900",
  cyan: "border-cyan-400 bg-cyan-200 hover:bg-cyan-300 text-cyan-900",
  sky: "border-sky-400 bg-sky-200 hover:bg-sky-300 text-sky-900",
  blue: "border-blue-400 bg-blue-200 hover:bg-blue-300 text-blue-900",
  indigo: "border-indigo-400 bg-indigo-200 hover:bg-indigo-300 text-indigo-900",
  violet: "border-violet-400 bg-violet-200 hover:bg-violet-300 text-violet-900",
  purple: "border-purple-400 bg-purple-200 hover:bg-purple-300 text-purple-900",
  pink: "border-pink-400 bg-pink-200 hover:bg-pink-300 text-pink-900",
  rose: "border-rose-400 bg-rose-200 hover:bg-rose-300 text-rose-900",
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
