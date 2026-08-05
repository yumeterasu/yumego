"use client";

import { useCallback, useEffect, useState } from "react";
import { SELECTED_CLASS_KEY } from "@/lib/classes";

/**
 * Reads/writes the class this tablet is locked to, persisted in
 * localStorage so it survives reopening the app on the same device.
 */
export function useSelectedClass() {
  const [selectedClass, setSelectedClassState] = useState<string | null>(
    null
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSelectedClassState(localStorage.getItem(SELECTED_CLASS_KEY));
    setLoaded(true);
  }, []);

  const setSelectedClass = useCallback((className: string) => {
    localStorage.setItem(SELECTED_CLASS_KEY, className);
    setSelectedClassState(className);
  }, []);

  const clearSelectedClass = useCallback(() => {
    localStorage.removeItem(SELECTED_CLASS_KEY);
    setSelectedClassState(null);
  }, []);

  return { selectedClass, setSelectedClass, clearSelectedClass, loaded };
}
