"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { MasterHoliday, ClassCalendarOverride } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export default function ClassCalendarPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [holidays, setHolidays] = useState<MasterHoliday[]>([]);
  const [overrides, setOverrides] = useState<ClassCalendarOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ date: string; label: string } | null>(
    null
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null);
  const [openConfirming, setOpenConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const [holidaysRes, overridesRes] = await Promise.all([
        fetch("/api/calendar/master"),
        fetch(`/api/calendar/class?class=${encodeURIComponent(selectedClass)}`),
      ]);
      if (!holidaysRes.ok || !overridesRes.ok) throw new Error("failed");
      const holidaysData = await holidaysRes.json();
      const overridesData = await overridesRes.json();
      setHolidays(holidaysData.holidays ?? []);
      setOverrides(overridesData.overrides ?? []);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedClass]);

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

  const holidayByDate = new Map(holidays.map((h) => [h.date, h.label]));
  const overrideByDate = new Map(overrides.map((o) => [o.date, o.isOpen]));
  const overrideLabelByDate = new Map(
    overrides.filter((o) => o.label).map((o) => [o.date, o.label as string])
  );

  function masterSaysOpen(date: string) {
    return !holidayByDate.has(date);
  }
  function isOpenFor(date: string) {
    return overrideByDate.has(date) ? overrideByDate.get(date)! : masterSaysOpen(date);
  }

  function toggleDay(date: string) {
    const currentlyOpen = isOpenFor(date);
    if (currentlyOpen) {
      // about to mark this day CLOSED — confirm first, with an optional label
      setConfirmClose({ date, label: "" });
    } else {
      // about to REOPEN this day — confirm first too
      setConfirmOpen(date);
    }
  }

  async function applyToggle(date: string, nextOpen: boolean, label?: string) {
    if (!selectedClass) return;
    const matchesMaster = nextOpen === masterSaysOpen(date);
    const nextOverrideValue = matchesMaster ? null : nextOpen;
    const nextLabel = nextOverrideValue === false ? (label ?? "") : undefined;

    setSavingDate(date);
    setError(null);
    // optimistic update
    const prevOverrides = overrides;
    setOverrides((prev) => {
      const withoutDate = prev.filter((o) => o.date !== date);
      return nextOverrideValue === null
        ? withoutDate
        : [
            ...withoutDate,
            { className: selectedClass, date, isOpen: nextOverrideValue, label: nextLabel },
          ];
    });

    try {
      const res = await fetch("/api/calendar/class", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          className: selectedClass,
          date,
          isOpen: nextOverrideValue,
          label: nextLabel,
        }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setError("保存に失敗しました / Failed to save");
      setOverrides(prevOverrides);
    } finally {
      setSavingDate(null);
    }
  }

  async function confirmCloseDay() {
    if (!confirmClose) return;
    setConfirming(true);
    await applyToggle(confirmClose.date, false, confirmClose.label);
    setConfirming(false);
    setConfirmClose(null);
  }

  async function confirmOpenDay() {
    if (!confirmOpen) return;
    setOpenConfirming(true);
    await applyToggle(confirmOpen, true);
    setOpenConfirming(false);
    setConfirmOpen(null);
  }

  const today = todayDateString();
  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...dayNumbers,
  ];

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass} カレンダー管理</h1>
          <p className="text-xs text-gray-400">
            {classNameToEnglish(selectedClass)} · Calendar Management
          </p>
          <p className="text-sm text-gray-500">
            祝日カレンダー（マスター）の設定を引き継ぎます。日付をタップすると開校・休校を切り替えられます
            <span className="block text-xs">
              Inherits from the Master Holiday Calendar — tap a date to toggle open/closed
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
            <span className="block text-[10px] font-normal opacity-70">
              Back to attendance
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

      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-white border border-gray-300 inline-block" />
          開校 / Open
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-100 inline-block" />
          休校 / Closed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-white border-2 border-purple-400 inline-block" />
          このクラスで変更済み / Overridden by this class
        </span>
      </div>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : (
        <div className="max-w-md w-full mx-auto border border-gray-300 rounded-xl p-4">
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((w, i) => (
              <div
                key={w}
                className={`text-xs font-semibold ${
                  i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : "text-gray-400"
                }`}
              >
                {w}
              </div>
            ))}
            {cells.map((day, idx) => {
              if (day === null) return <div key={idx} />;
              const date = `${year}-${pad2(month)}-${pad2(day)}`;
              const open = isOpenFor(date);
              const hasOverride = overrideByDate.has(date);
              const label = overrideLabelByDate.get(date) ?? holidayByDate.get(date);
              const isToday = date === today;
              const isSaving = savingDate === date;
              return (
                <button
                  key={idx}
                  onClick={() => toggleDay(date)}
                  disabled={isSaving}
                  title={label || undefined}
                  className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 ${
                    open ? "bg-white hover:bg-gray-50" : "bg-red-100 hover:bg-red-200"
                  } ${hasOverride ? "border-2 border-purple-400" : "border border-gray-200"} ${
                    isToday ? "ring-2 ring-green-500" : ""
                  }`}
                >
                  <span className={open ? "text-gray-700" : "text-red-800 font-bold"}>{day}</span>
                  {!open && <span className="text-[9px] leading-none">祝</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {confirmClose && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !confirming && setConfirmClose(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {confirmClose.date}
              <span className="block text-sm font-normal text-gray-500">
                この日を休校にする / Mark this day as closed
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              名前（任意）
              <span className="text-xs font-normal text-gray-500">
                Label (optional — leave blank and press OK is fine)
              </span>
              <input
                type="text"
                value={confirmClose.label}
                onChange={(e) => setConfirmClose({ ...confirmClose, label: e.target.value })}
                placeholder="例：遠足のため"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmClose(null)}
                disabled={confirming}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={confirmCloseDay}
                disabled={confirming}
                className="rounded-full bg-red-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !openConfirming && setConfirmOpen(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {confirmOpen}
              <span className="block text-sm font-normal text-gray-500">
                この日を開校に戻す / Reopen this day
              </span>
              {(overrideLabelByDate.get(confirmOpen) ?? holidayByDate.get(confirmOpen)) && (
                <span className="block text-xs text-gray-400 mt-1">
                  現在の休校名：{overrideLabelByDate.get(confirmOpen) ?? holidayByDate.get(confirmOpen)}
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmOpen(null)}
                disabled={openConfirming}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={confirmOpenDay}
                disabled={openConfirming}
                className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
