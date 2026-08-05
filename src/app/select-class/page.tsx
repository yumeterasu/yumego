"use client";

import { useRouter } from "next/navigation";
import { CLASSES } from "@/lib/classes";
import { useSelectedClass } from "@/hooks/useSelectedClass";

export default function SelectClassPage() {
  const router = useRouter();
  const { setSelectedClass } = useSelectedClass();

  function handleSelect(className: string) {
    setSelectedClass(className);
    router.replace("/attendance");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-2xl font-bold">このタブレットのクラスを選んでください</h1>
      <p className="text-sm text-gray-500">
        一度選ぶと、このタブレットではそのクラスが記憶されます
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
        {CLASSES.map((className) => (
          <button
            key={className}
            onClick={() => handleSelect(className)}
            className="rounded-xl border border-gray-300 px-6 py-8 text-lg font-semibold hover:bg-gray-100 active:scale-95 transition"
          >
            {className}
          </button>
        ))}
      </div>
    </main>
  );
}
