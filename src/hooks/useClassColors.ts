"use client";

import { useEffect, useState } from "react";

/** className -> color key (e.g. "blue") and className -> planet key (e.g.
 *  "mars"), each only for classes that have one set -- independent of
 *  each other, both fetched from the same /api/class-colors response. */
export function useClassColors() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [planets, setPlanets] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/class-colors")
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => {
        const colorMap: Record<string, string> = {};
        const planetMap: Record<string, string> = {};
        for (const c of (d.colors ?? []) as { className: string; color: string; planet: string }[]) {
          if (c.color) colorMap[c.className] = c.color;
          if (c.planet) planetMap[c.className] = c.planet;
        }
        setColors(colorMap);
        setPlanets(planetMap);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { colors, planets, loaded };
}
