"use client";

import { useRouter } from "next/navigation";
import { CLASSES } from "@/lib/classes";
import { useSelectedClass } from "@/hooks/useSelectedClass";

const PROMPONG_CLASSES = CLASSES.filter((c) => c.startsWith("プロンポン"));
const THONGLOR_CLASSES = CLASSES.filter((c) => c.startsWith("トンロー"));

export default function SelectClassPage() {
  const router = useRouter();
  const { setSelectedClass } = useSelectedClass();

  function handleSelect(className: string) {
    setSelectedClass(className);
    router.replace("/dashboard");
  }

  function ClassButton({ name }: { name: string }) {
    return (
      <button
        onClick={() => handleSelect(name)}
        className="rounded-xl border border-gray-300 px-6 py-8 text-lg font-semibold hover:bg-gray-100 active:scale-95 transition"
      >
        {name}
      </button>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-2xl font-bold">このタブレットのクラスを選んでください</h1>
      <p className="text-sm text-gray-500">
        一度選ぶと、このタブレットではそのクラスが記憶されます
      </p>

      {/* Tablet / mobile: simple single grid, unchanged */}
      <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
        {CLASSES.map((name) => (
          <ClassButton key={name} name={name} />
        ))}
      </div>

      {/* Desktop (wide screens): split into プロンポン (left) / トンロー (right) */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-10 w-full max-w-2xl">
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-center text-gray-700">
            プロンポン
          </h2>
          {PROMPONG_CLASSES.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-center text-gray-700">
            トンロー
          </h2>
          {THONGLOR_CLASSES.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
        </div>
      </div>
    </main>
  );
}
