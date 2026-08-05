"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";

export default function Home() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  useEffect(() => {
    if (!loaded) return;
    router.replace(selectedClass ? "/attendance" : "/select-class");
  }, [loaded, selectedClass, router]);

  return null;
}
