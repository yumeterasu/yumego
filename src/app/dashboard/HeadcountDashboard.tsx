"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { classNameToEnglish } from "@/lib/classes";
import { apiFetch, SessionExpiredError } from "@/lib/apiFetch";
import { SkeletonBlock } from "@/components/Skeleton";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate(); // month is 1-based
}
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// Same weekend color convention as the normal grid (src/app/dashboard/page.tsx).
function weekendHeaderClasses(dow: number): string {
  if (dow === 0) return "bg-red-200 text-red-800";
  if (dow === 6) return "bg-blue-200 text-blue-800";
  return "bg-gray-50";
}
function weekendCellClasses(dow: number): string {
  if (dow === 0) return "bg-red-100";
  if (dow === 6) return "bg-blue-100";
  return "";
}

/**
 * Monthly attendance grid for an ExtraClass with kind === "headcount" — no
 * student roster exists for these classes, so instead of per-student rows
 * this renders a single "出席人数 / Present" row with one free numeric
 * entry per day (any date, no locking), laid out exactly like the normal
 * class's monthly grid (same day-column header/weekend colors). The
 * rightmost column is a client-side sum of the month, not a separate
 * input. Save flow (floor/validate, confirm-on-change, revert-on-failure)
 * mirrors 専門コーチ's "最" row free numeric entry
 * (src/app/dashboard/specialist/page.tsx).
 */
export default function HeadcountDashboard({
  className,
  extraClassEnNames,
}: {
  className: string;
  extraClassEnNames: Record<string, string>;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  // date ("YYYY-MM-DD") -> saved present count, only for days with a value.
  const [entries, setEntries] = useState<Record<string, number>>({});
  // day-of-month -> draft input string, always present for every day 1..N.
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDay, setSavingDay] = useState<number | null>(null);

  const yearMonth = `${year}-${pad2(month)}`;
  const numDays = daysInMonth(year, month);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/attendance-headcount?class=${encodeURIComponent(className)}&month=${yearMonth}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((data: { entries: Record<string, number> }) => {
        if (cancelled) return;
        const next = data.entries ?? {};
        setEntries(next);
        const nextDraft: Record<number, string> = {};
        for (let day = 1; day <= daysInMonth(year, month); day++) {
          const date = `${yearMonth}-${pad2(day)}`;
          nextDraft[day] = next[date] === undefined ? "" : String(next[date]);
        }
        setDraft(nextDraft);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          setError("__SESSION_EXPIRED__");
        } else {
          setError("データの取得に失敗しました / Failed to load data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [className, yearMonth]);

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

  async function commitDay(day: number, rawValue: string) {
    const date = `${yearMonth}-${pad2(day)}`;
    const original = entries[date] ?? null;
    const trimmed = rawValue.trim();
    let parsed: number | null = trimmed === "" ? null : Number(trimmed);

    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setDraft((prev) => ({ ...prev, [day]: original === null ? "" : String(original) }));
      return;
    }
    if (parsed !== null) parsed = Math.floor(parsed);

    if (parsed === original) {
      setDraft((prev) => ({ ...prev, [day]: parsed === null ? "" : String(parsed) }));
      return;
    }

    // Number inputs misfire easily (scroll wheel, stray taps on the
    // up/down arrows) — confirm before actually writing a real change.
    const fromLabel = original === null ? "未入力" : String(original);
    const toLabel = parsed === null ? "未入力" : String(parsed);
    if (
      !window.confirm(
        `${year}年${month}月${day}日 の出席人数を ${fromLabel} → ${toLabel} に変更しますか？\nChange the present count for ${year}-${pad2(
          month
        )}-${pad2(day)} from ${fromLabel} to ${toLabel}?`
      )
    ) {
      setDraft((prev) => ({ ...prev, [day]: original === null ? "" : String(original) }));
      return;
    }

    setSavingDay(day);
    setError(null);
    try {
      const res = await fetch("/api/attendance-headcount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className, date, total: null, present: parsed, absent: null }),
      });
      if (!res.ok) throw new Error("failed");
      setEntries((prev) => {
        const next = { ...prev };
        if (parsed === null) delete next[date];
        else next[date] = parsed;
        return next;
      });
      setDraft((prev) => ({ ...prev, [day]: parsed === null ? "" : String(parsed) }));
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDraft((prev) => ({ ...prev, [day]: original === null ? "" : String(original) }));
    } finally {
      setSavingDay(null);
    }
  }

  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);
  const total = Object.entries(entries)
    .filter(([date]) => date.startsWith(yearMonth))
    .reduce((sum, [, count]) => sum + count, 0);

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{className}</h1>
          <p className="text-xs text-gray-400">{classNameToEnglish(className, extraClassEnNames)}</p>
          <p className="text-sm text-gray-500">
            出席人数記録
            <span className="ml-1 text-xs text-gray-400">Headcount Record</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <Link
            href="/"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600 text-sm text-center">
            {error === "__SESSION_EXPIRED__"
              ? "セッションの有効期限が切れました / Your session has expired"
              : error}
          </p>
          {error === "__SESSION_EXPIRED__" && (
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 text-base font-semibold"
            >
              🔄 ページを再読み込み
              <span className="block text-xs font-normal opacity-80">Reload page</span>
            </button>
          )}
        </div>
      )}

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

      {loading ? (
        <SkeletonBlock />
      ) : (
        <div className="self-start max-w-full overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10">
                  出席人数
                  <span className="block text-[9px] font-normal text-gray-400">Present</span>
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-2 py-1 text-center w-9 ${weekendHeaderClasses(dow)}`}
                    >
                      <div>{day}</div>
                      <div className="text-[10px] font-normal">{WEEKDAY_LABELS[dow]}</div>
                    </th>
                  );
                })}
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-14">
                  合計
                  <span className="block text-[9px] font-normal">Total</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap">
                  出席人数
                  <span className="block text-[10px] text-gray-400">Present</span>
                </td>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  return (
                    <td
                      key={day}
                      className={`text-center border border-gray-300 p-0 ${weekendCellClasses(dow)}`}
                    >
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={draft[day] ?? ""}
                        disabled={savingDay !== null}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [day]: e.target.value }))}
                        onBlur={(e) => commitDay(day, e.target.value)}
                        className="w-9 h-9 text-center bg-transparent font-semibold disabled:opacity-50"
                      />
                    </td>
                  );
                })}
                <td className="text-center border border-gray-300 font-semibold text-green-700">
                  {total}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
