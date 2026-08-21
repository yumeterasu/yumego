"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CLASSES, classNameToEnglish } from "@/lib/classes";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { Bi } from "@/components/Bilingual";

const PROMPONG_REGULAR = CLASSES.filter(
  (c) => c.startsWith("プロンポン") && !c.endsWith("夏")
);
const PROMPONG_SUMMER = CLASSES.filter((c) => c.startsWith("プロンポン") && c.endsWith("夏"));
const THONGLOR_REGULAR = CLASSES.filter(
  (c) => c.startsWith("トンロー") && !c.endsWith("夏")
);
const THONGLOR_SUMMER = CLASSES.filter((c) => c.startsWith("トンロー") && c.endsWith("夏"));

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateString(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayDateString() {
  return toDateString(new Date());
}

function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return toDateString(date);
}

export default function SelectClassPage() {
  const router = useRouter();
  const { setSelectedClass } = useSelectedClass();

  const today = todayDateString();
  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/daily?date=${date}`);
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setSummary(data.summary ?? {});
    } catch {
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary(selectedDate);
  }, [selectedDate, loadSummary]);

  function handleSelect(className: string) {
    setSelectedClass(className);
    router.replace("/dashboard");
  }

  function ClassButton({ name }: { name: string }) {
    const count = summary[name];
    const checked = count !== undefined;
    return (
      <button
        onClick={() => handleSelect(name)}
        className="relative rounded-xl border border-gray-300 px-6 py-4 text-lg font-semibold hover:bg-gray-100 active:scale-95 transition"
      >
        <span className="block">{name}</span>
        <span className="block text-xs font-normal opacity-70">
          {classNameToEnglish(name)}
        </span>
        {checked && (
          <span className="absolute top-1.5 right-3 text-sm font-bold text-green-700 bg-green-50 border border-green-300 rounded-full px-2 py-0.5">
            出席 {count}
            <span className="block text-[9px] font-normal">Present</span>
          </span>
        )}
      </button>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-4">
      {/* 送迎管理 — a separate whole-branch entry point, not gated on a class */}
      <div className="flex gap-3">
        <Link
          href="/dashboard/pickup?branch=プロンポン"
          className="rounded-full bg-blue-50 border border-blue-300 text-blue-700 px-4 py-2 text-sm font-semibold text-center"
        >
          🚌 送迎管理　プロンポン
          <span className="block text-[9px] font-normal opacity-70">
            Pickup/Drop-off · Phrom Phong
          </span>
        </Link>
        <Link
          href="/dashboard/pickup?branch=トンロー"
          className="rounded-full bg-blue-50 border border-blue-300 text-blue-700 px-4 py-2 text-sm font-semibold text-center"
        >
          🚌 送迎管理　トンロー
          <span className="block text-[9px] font-normal opacity-70">
            Pickup/Drop-off · Thong Lo
          </span>
        </Link>
      </div>

      <h1 className="text-xl font-bold text-center">
        <Bi
          ja="この端末のクラスを選んでください"
          en="Please choose this device's class"
          enClassName="block text-sm font-normal text-gray-500 mt-1"
        />
      </h1>

      <div className="flex items-center gap-4">
        <button
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          className="rounded-full bg-gray-100 text-gray-600 w-8 h-8 flex items-center justify-center"
          aria-label="前の日 / Previous day"
        >
          ◀
        </button>
        <div className="flex flex-col items-center">
          <p className="font-bold text-sm">{selectedDate}</p>
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              className="text-xs text-blue-600 underline"
            >
              今日に戻る / Back to today
            </button>
          )}
        </div>
        <button
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          disabled={selectedDate >= today}
          className="rounded-full bg-gray-100 text-gray-600 w-8 h-8 flex items-center justify-center disabled:opacity-30"
          aria-label="次の日 / Next day"
        >
          ▶
        </button>
      </div>

      {/* Tablet / mobile: simple single grid, unchanged */}
      <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {[...PROMPONG_REGULAR, ...THONGLOR_REGULAR].map((name) => (
          <ClassButton key={name} name={name} />
        ))}
        <div className="col-span-full border-t border-gray-200 my-1" />
        {[...PROMPONG_SUMMER, ...THONGLOR_SUMMER].map((name) => (
          <ClassButton key={name} name={name} />
        ))}
      </div>

      {/* Desktop (wide screens): split into プロンポン (left) / トンロー (right) */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-10 w-full max-w-2xl">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-center text-gray-700">
            プロンポン
            <span className="block text-xs font-normal opacity-70">Phrom Phong</span>
          </h2>
          {PROMPONG_REGULAR.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
          <div className="border-t border-gray-200 my-1" />
          {PROMPONG_SUMMER.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-center text-gray-700">
            トンロー
            <span className="block text-xs font-normal opacity-70">Thong Lo</span>
          </h2>
          {THONGLOR_REGULAR.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
          <div className="border-t border-gray-200 my-1" />
          {THONGLOR_SUMMER.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
        </div>
      </div>
    </main>
  );
}
