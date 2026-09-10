"use client";

import { useEffect, useState } from "react";

/** className -> teacher's display name, only for classes that have one set. */
export function useClassTeachers() {
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/class-teacher")
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => {
        const map: Record<string, string> = {};
        for (const a of (d.assignments ?? []) as {
          className: string;
          teacherName: string;
        }[]) {
          if (a.teacherName) map[a.className] = a.teacherName;
        }
        setTeacherNames(map);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { teacherNames, loaded };
}
