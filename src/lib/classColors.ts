// Curated palette for per-class button colors (top page). Tailwind's
// build-time scanner needs literal class name strings in the source to
// generate their CSS, so these live as a fixed lookup table rather than
// being interpolated from a free color value fetched at runtime.

export const CLASS_COLOR_OPTIONS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose",
] as const;

export type ClassColorKey = (typeof CLASS_COLOR_OPTIONS)[number];

/**
 * Card-style button (top page class buttons): pale background kept as-is,
 * but border + text use a darker shade of the same color for definition
 * and readability against the pale fill.
 */
export const CLASS_COLOR_CARD_STYLES: Record<ClassColorKey, string> = {
  red: "border-red-400 bg-red-50 hover:bg-red-100 text-red-800",
  orange: "border-orange-400 bg-orange-50 hover:bg-orange-100 text-orange-800",
  amber: "border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-800",
  yellow: "border-yellow-400 bg-yellow-50 hover:bg-yellow-100 text-yellow-800",
  lime: "border-lime-400 bg-lime-50 hover:bg-lime-100 text-lime-800",
  green: "border-green-400 bg-green-50 hover:bg-green-100 text-green-800",
  emerald: "border-emerald-400 bg-emerald-50 hover:bg-emerald-100 text-emerald-800",
  teal: "border-teal-400 bg-teal-50 hover:bg-teal-100 text-teal-800",
  cyan: "border-cyan-400 bg-cyan-50 hover:bg-cyan-100 text-cyan-800",
  sky: "border-sky-400 bg-sky-50 hover:bg-sky-100 text-sky-800",
  blue: "border-blue-400 bg-blue-50 hover:bg-blue-100 text-blue-800",
  indigo: "border-indigo-400 bg-indigo-50 hover:bg-indigo-100 text-indigo-800",
  violet: "border-violet-400 bg-violet-50 hover:bg-violet-100 text-violet-800",
  purple: "border-purple-400 bg-purple-50 hover:bg-purple-100 text-purple-800",
  pink: "border-pink-400 bg-pink-50 hover:bg-pink-100 text-pink-800",
  rose: "border-rose-400 bg-rose-50 hover:bg-rose-100 text-rose-800",
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

// クラス惑星 — an independent, optional per-class identifier alongside
// Color above (not a replacement for it): a small solar-system badge
// shown next to the class name, since a bare colored dot is easy to
// misread while a named planet (with its own look -- Saturn's ring, the
// Sun's glow) is easier to tell apart and remember at a glance,
// especially for young children. Rendered via CSS gradients (see
// CLASS_PLANET_GRADIENTS) rather than real images or Tailwind utility
// classes, since a radial-gradient sphere isn't expressible as a static
// Tailwind class name the build-time scanner could pick up.
export const CLASS_PLANET_OPTIONS = [
  "sun", "mercury", "venus", "earth", "mars",
  "jupiter", "saturn", "uranus", "neptune", "pluto",
] as const;

export type ClassPlanetKey = (typeof CLASS_PLANET_OPTIONS)[number];

export const CLASS_PLANET_LABELS: Record<ClassPlanetKey, string> = {
  sun: "Sun",
  mercury: "Mercury",
  venus: "Venus",
  earth: "Earth",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
};

export const CLASS_PLANET_GRADIENTS: Record<ClassPlanetKey, string> = {
  sun: "radial-gradient(circle at 34% 30%, #fff3c4, #f7c948 45%, #e08a1f 78%, #b8560f 100%)",
  mercury: "radial-gradient(circle at 32% 28%, #cfc3b8, #9c8f83 50%, #6b5f56 85%)",
  venus: "radial-gradient(circle at 32% 28%, #ffe9b8, #e8c07d 45%, #b98a4a 85%)",
  earth: "radial-gradient(circle at 30% 26%, #9fd8ff, #3f8fd6 40%, #2f6a9e 65%, #1c3f61 100%)",
  mars: "radial-gradient(circle at 32% 28%, #ffb08a, #d9633a 48%, #92351a 85%)",
  jupiter: "radial-gradient(circle at 30% 26%, #f6e2c0, #d9a465 42%, #a5652f 68%, #7a4520 100%)",
  saturn: "radial-gradient(circle at 32% 28%, #fbedc9, #e0bd7d 48%, #a3803f 85%)",
  uranus: "radial-gradient(circle at 32% 28%, #d4faf3, #8fdbd0 48%, #4f9c95 85%)",
  neptune: "radial-gradient(circle at 32% 28%, #b7c8ff, #4b62c9 48%, #26337e 85%)",
  pluto: "radial-gradient(circle at 32% 28%, #ece4e8, #b9a9b3 48%, #7c6c76 85%)",
};

/** Only Saturn gets the rendered ring overlay (see components/PlanetDot.tsx). */
export const CLASS_PLANET_HAS_RING: Record<ClassPlanetKey, boolean> = {
  sun: false,
  mercury: false,
  venus: false,
  earth: false,
  mars: false,
  jupiter: false,
  saturn: true,
  uranus: false,
  neptune: false,
  pluto: false,
};

export function isClassPlanetKey(value: string): value is ClassPlanetKey {
  return (CLASS_PLANET_OPTIONS as readonly string[]).includes(value);
}
