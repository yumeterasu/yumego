"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { useExtraClasses } from "@/hooks/useExtraClasses";
import { classNameToEnglish } from "@/lib/classes";
import type { OutingLog } from "@/lib/sheets";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function OutingsSummaryPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();
  const { enNames: extraClassEnNames } = useExtraClasses();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [entries, setEntries] = useState<OutingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/outings?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, yearMonth]);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load();
  }, [loaded, selectedClass, router, load]);

  function goPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  if (!loaded || !selectedClass) return null;

  const totalOutings = entries.length;
  const totalHeadcount = entries.reduce((sum, e) => sum + e.headcount, 0);
  const pending = entries.filter((e) => e.returnTime === "");

  // destination name -> { count, headcount }
  const byDestination = new Map<string, { count: number; headcount: number }>();
  for (const e of entries) {
    const key = e.description.trim() || "（行き先未記入）";
    const cur = byDestination.get(key) ?? { count: 0, headcount: 0 };
    cur.count += 1;
    cur.headcount += e.headcount;
    byDestination.set(key, cur);
  }
  const ranked = Array.from(byDestination.entries()).sort((a, b) => b[1].count - a[1].count);
  const maxCount = ranked.length > 0 ? ranked[0][1].count : 0;

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass} 入退出まとめ</h1>
          <p className="text-xs text-gray-400">
            {classNameToEnglish(selectedClass, extraClassEnNames)} · Entry/Exit Summary
          </p>
          <p className="text-sm text-gray-500">
            この月の外出回数・人数・行き先の内訳
            <span className="block text-xs">
              Outing count, headcount, and destination breakdown for the month
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/outings"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 入退出記録に戻る
            <span className="block text-[10px] font-normal opacity-70">
              Back to entry/exit log
            </span>
          </Link>
          <Link
            href="/select-class"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={goPrevMonth}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="前の月 / Previous month"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-32 text-center">
          {year}年{month}月
        </p>
        <button
          onClick={goNextMonth}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="次の月 / Next month"
        >
          ▶
        </button>
      </div>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : (
        <div className="max-w-2xl w-full mx-auto flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="border rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-gray-800">{totalOutings}</p>
              <p className="text-xs text-gray-500 mt-1">
                総回数
                <span className="block text-[10px] text-gray-400">Total outings</span>
              </p>
            </div>
            <div className="border rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-gray-800">{totalHeadcount}</p>
              <p className="text-xs text-gray-500 mt-1">
                延べ人数
                <span className="block text-[10px] text-gray-400">Total headcount</span>
              </p>
            </div>
            <div
              className={`border rounded-xl p-4 text-center ${
                pending.length > 0 ? "border-amber-400 bg-amber-50/50" : ""
              }`}
            >
              <p
                className={`text-3xl font-bold ${
                  pending.length > 0 ? "text-amber-600" : "text-gray-800"
                }`}
              >
                {pending.length}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                未入室
                <span className="block text-[10px] text-gray-400">Not back yet</span>
              </p>
            </div>
          </div>

          {pending.length > 0 && (
            <div className="border border-amber-400 bg-amber-50/50 rounded-xl p-3 flex flex-col gap-1">
              <p className="text-sm font-semibold text-amber-800">
                まだ入室記録がありません
                <span className="block text-xs font-normal">Not yet recorded as returned</span>
              </p>
              {pending.map((e) => (
                <p key={e.id} className="text-xs text-amber-700">
                  {e.date} {e.departureTime}〜　{e.description || "（行き先未記入）"}　{e.headcount}
                  人
                </p>
              ))}
            </div>
          )}

          <div className="border rounded-xl p-4 flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-gray-700">
              行き先の内訳
              <span className="block text-xs font-normal text-gray-400">
                Breakdown by destination
              </span>
            </h2>
            {ranked.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">
                この月の記録はまだありません
                <span className="block text-xs">No records yet this month</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {ranked.map(([name, stat]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="text-sm w-32 shrink-0 truncate" title={name}>
                      {name}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-green-500 h-full rounded-full"
                        style={{ width: `${(stat.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-24 shrink-0 text-right">
                      {stat.count}回 / {stat.headcount}人
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
