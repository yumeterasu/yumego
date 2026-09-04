"use client";

import { useEffect, useState } from "react";

/** className -> color key (e.g. "blue"), only for classes that have one set. */
export function useClassColors() {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/class-colors")
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => {
        const map: Record<string, string> = {};
        for (const c of (d.colors ?? []) as { className: string; color: string }[]) {
          map[c.className] = c.color;
        }
        setColors(map);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { colors, loaded };
}
