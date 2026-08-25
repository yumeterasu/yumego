"use client";

import { useEffect, useState } from "react";
import type { ExtraClass } from "@/lib/sheets";

/**
 * Master-managed classes outside the 年少/年中/年長 continuum (see
 * ExtraClasses!A:E via /api/extra-classes). Fetched once per page load —
 * `enNames` feeds classNameToEnglish() so a renamed extra class's English
 * gloss updates everywhere without a code change; `activeClasses` is what
 * the top page groups into its per-branch "extra" section.
 */
export function useExtraClasses() {
  const [classes, setClasses] = useState<ExtraClass[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/extra-classes")
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((d) => setClasses(d.classes ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const activeClasses = classes.filter((c) => c.active);
  const enNames: Record<string, string> = Object.fromEntries(
    classes.map((c) => [`${c.branch}　${c.suffix}`, c.nameEn])
  );

  return { classes, activeClasses, enNames, loaded };
}
