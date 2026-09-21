"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type Branch, branchToEnglish } from "@/lib/classes";
import { apiFetch, SessionExpiredError } from "@/lib/apiFetch";
import { SkeletonBlock } from "@/components/Skeleton";
import type { OutingLog } from "@/lib/sheets";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function OutingsSummaryPageInner() {
  const searchParams = useSearchParams();
  const branch = (searchParams.get("branch") ?? "") as Branch | "";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [entries, setEntries] = useState<OutingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Oldest first (top), newest last (bottom) by default -- click the 日付
  // header to flip it, same comparison key the log itself sorts by.
  const [sortAsc, setSortAsc] = useState(true);

  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/outings?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setError("__SESSION_EXPIRED__");
      } else {
        setError("データの取得に失敗しました / Failed to load data");
      }
    } finally {
      setLoading(false);
    }
  }, [branch, yearMonth]);

  useEffect(() => {
    if (!branch) return;
    load();
  }, [branch, load]);

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

  if (!branch) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center flex flex-col items-center gap-3">
          <p className="text-gray-500 text-sm">
            支店が選択されていません
            <span className="block text-xs">No branch selected</span>
          </p>
          <Link href="/select-class" className="text-blue-600 underline text-sm">
            トップページに戻る / Back to top page
          </Link>
        </div>
      </main>
    );
  }

  const sortedEntries = [...entries].sort((a, b) => {
    const cmp = (a.date + a.departureTime).localeCompare(b.date + b.departureTime);
    return sortAsc ? cmp : -cmp;
  });

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{branch} 入退出まとめ</h1>
          <p className="text-xs text-gray-400">
            {branchToEnglish(branch)} · Entry/Exit Summary
          </p>
          <p className="text-sm text-gray-500">
            この月の入退出記録一覧
            <span className="block text-xs">Entry/exit records for the month</span>
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Link
            href={`/dashboard/outings?branch=${encodeURIComponent(branch)}`}
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

      {error && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600 text-sm text-center">
            {error === "__SESSION_EXPIRED__"
              ? "セッションの有効期限が切れました / Your session has expired"
              : error}
          </p>
          <button
            onClick={error === "__SESSION_EXPIRED__" ? () => window.location.reload() : () => load()}
            className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 text-base font-semibold"
          >
            {error === "__SESSION_EXPIRED__" ? "🔄 ページを再読み込み" : "🔄 再読み込み"}
            <span className="block text-xs font-normal opacity-80">
              {error === "__SESSION_EXPIRED__" ? "Reload page" : "Retry"}
            </span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="max-w-2xl w-full mx-auto">
          <SkeletonBlock className="h-[360px]" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          この月の記録はまだありません
          <span className="block text-xs">No records yet this month</span>
        </p>
      ) : (
        <div className="max-w-5xl w-full mx-auto overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max w-full">
            <thead>
              <tr>
                <th className="border border-gray-300 bg-gray-50 px-3 py-2">
                  <button
                    onClick={() => setSortAsc((v) => !v)}
                    className="flex items-center gap-1 mx-auto font-semibold"
                  >
                    日付
                    <span className="text-[10px]">{sortAsc ? "▲" : "▼"}</span>
                  </button>
                  <span className="block text-[9px] font-normal text-gray-400">DATE</span>
                </th>
                <th className="border border-gray-300 bg-gray-50 px-3 py-2">
                  学年
                  <span className="block text-[9px] font-normal text-gray-400">CLASS</span>
                </th>
                <th className="border border-gray-300 bg-gray-50 px-3 py-2">
                  人数
                  <span className="block text-[9px] font-normal text-gray-400">
                    Number of people
                  </span>
                </th>
                <th className="border border-gray-300 bg-amber-100 text-amber-800 px-3 py-2">
                  退室時間
                  <span className="block text-[9px] font-normal">Leaving time</span>
                </th>
                <th className="border border-gray-300 bg-amber-100 text-amber-800 px-3 py-2">
                  退室確認サイン
                  <span className="block text-[9px] font-normal">Sign</span>
                </th>
                <th className="border border-gray-300 bg-blue-100 text-blue-800 px-3 py-2">
                  入室時間
                  <span className="block text-[9px] font-normal">Entry time</span>
                </th>
                <th className="border border-gray-300 bg-blue-100 text-blue-800 px-3 py-2">
                  入室確認サイン
                  <span className="block text-[9px] font-normal">Sign</span>
                </th>
                <th className="border border-gray-300 bg-gray-50 px-3 py-2">
                  行き先
                  <span className="block text-[9px] font-normal text-gray-400">Destination</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => {
                const isBack = entry.returnTime !== "";
                return (
                  <tr key={entry.id} className={isBack ? "" : "bg-amber-50/50"}>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {entry.date}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {entry.className.split("　")[1] ?? entry.className}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {entry.headcount}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {entry.departureTime}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {entry.departureSign}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {isBack ? (
                        entry.returnTime
                      ) : (
                        <span className="text-amber-700 font-semibold">
                          未入室 / Not back yet
                        </span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center whitespace-nowrap">
                      {entry.returnSign}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {entry.description || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function OutingsSummaryPage() {
  return (
    <Suspense fallback={null}>
      <OutingsSummaryPageInner />
    </Suspense>
  );
}
