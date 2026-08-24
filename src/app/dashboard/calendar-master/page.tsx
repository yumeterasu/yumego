"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { MasterHoliday } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const MONTH_EN = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
];
// Japanese school year: April through March.
const FISCAL_MONTHS: { monthNum: number; yearOffset: 0 | 1 }[] = [
  { monthNum: 4, yearOffset: 0 },
  { monthNum: 5, yearOffset: 0 },
  { monthNum: 6, yearOffset: 0 },
  { monthNum: 7, yearOffset: 0 },
  { monthNum: 8, yearOffset: 0 },
  { monthNum: 9, yearOffset: 0 },
  { monthNum: 10, yearOffset: 0 },
  { monthNum: 11, yearOffset: 0 },
  { monthNum: 12, yearOffset: 0 },
  { monthNum: 1, yearOffset: 1 },
  { monthNum: 2, yearOffset: 1 },
  { monthNum: 3, yearOffset: 1 },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function defaultFiscalYearStart(): number {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

function MonthGrid({
  year,
  monthNum,
  monthEn,
  holidayByDate,
  onDayClick,
}: {
  year: number;
  monthNum: number;
  monthEn: string;
  holidayByDate: Map<string, string>;
  onDayClick: (date: string, currentLabel: string | undefined) => void;
}) {
  const numDays = daysInMonth(year, monthNum);
  const firstDow = new Date(year, monthNum - 1, 1).getDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];

  return (
    <div className="border border-gray-300 rounded-xl p-3 flex flex-col gap-2">
      <h3 className="text-sm font-bold text-center">
        {year}年{monthNum}月
        <span className="block text-[10px] font-normal text-gray-400">{monthEn}</span>
      </h3>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className={`text-[10px] font-semibold ${
              i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : "text-gray-400"
            }`}
          >
            {w}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} />;
          const date = `${year}-${pad2(monthNum)}-${pad2(day)}`;
          const label = holidayByDate.get(date);
          const isHoliday = label !== undefined;
          return (
            <button
              key={idx}
              onClick={() => onDayClick(date, label)}
              className={`aspect-square rounded text-[11px] leading-tight flex flex-col items-center justify-center ${
                isHoliday
                  ? "bg-red-100 text-red-800 font-bold"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
              title={label || undefined}
            >
              <span>{day}</span>
              {isHoliday && label && (
                <span className="text-[7px] leading-none truncate w-full px-0.5">{label}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MasterCalendarPage() {
  const [fiscalYearStart, setFiscalYearStart] = useState(defaultFiscalYearStart);
  const [holidays, setHolidays] = useState<MasterHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ date: string; label: string; isNew: boolean } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/master");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setHolidays(data.holidays ?? []);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const holidayByDate = new Map(holidays.map((h) => [h.date, h.label]));

  function handleDayClick(date: string, currentLabel: string | undefined) {
    if (currentLabel === undefined) {
      // not yet a holiday — open the popup to add one (label optional, OK with blank is fine)
      setEditing({ date, label: "", isNew: true });
      return;
    }
    // already a holiday — open the manage popup (rename or remove)
    setEditing({ date, label: currentLabel, isNew: false });
  }

  async function saveLabel() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: editing.date, label: editing.label }),
      });
      if (!res.ok) throw new Error("failed");
      setHolidays((prev) =>
        editing.isNew
          ? [...prev, { date: editing.date, label: editing.label }]
          : prev.map((h) => (h.date === editing.date ? { ...h, label: editing.label } : h))
      );
      setEditing(null);
    } catch {
      setError("保存に失敗しました / Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function removeHoliday() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: editing.date, label: null }),
      });
      if (!res.ok) throw new Error("failed");
      setHolidays((prev) => prev.filter((h) => h.date !== editing.date));
      setEditing(null);
    } catch {
      setError("削除に失敗しました / Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">祝日カレンダー（マスター）</h1>
          <p className="text-xs text-gray-400">Master Holiday Calendar</p>
          <p className="text-sm text-gray-500">
            学校全体の休日を設定します。各クラスのカレンダーはここから初期値を引き継ぎます
            <span className="block text-xs">
              School-wide holidays — each class's calendar starts from these by default
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          onClick={() => setFiscalYearStart((y) => y - 1)}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="前年度 / Previous fiscal year"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-40 text-center">{fiscalYearStart}年度</p>
        <button
          onClick={() => setFiscalYearStart((y) => y + 1)}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="翌年度 / Next fiscal year"
        >
          ▶
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        日付をタップすると祝日として登録されます。登録済みの日付をタップすると名前の編集・削除ができます
        <span className="block">
          Tap a date to mark it as a holiday. Tap an already-marked date to rename or remove it
        </span>
      </p>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-w-5xl w-full mx-auto">
          {FISCAL_MONTHS.map((fm, idx) => (
            <MonthGrid
              key={fm.monthNum}
              year={fiscalYearStart + fm.yearOffset}
              monthNum={fm.monthNum}
              monthEn={MONTH_EN[idx]}
              holidayByDate={holidayByDate}
              onDayClick={handleDayClick}
            />
          ))}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {editing.date}
              <span className="block text-sm font-normal text-gray-500">
                {editing.isNew ? "祝日として登録 / Add as holiday" : "祝日の編集 / Edit holiday"}
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              名前（任意）
              <span className="text-xs font-normal text-gray-500">
                Label (optional — leave blank and press OK is fine)
              </span>
              <input
                type="text"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="例：ソンクラーン"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={saveLabel}
                disabled={saving}
                className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                OK
              </button>
            </div>
            {!editing.isNew && (
              <button
                onClick={removeHoliday}
                disabled={saving}
                className="rounded-full border border-red-300 text-red-600 py-2.5 font-semibold disabled:opacity-40"
              >
                この日を祝日から外す / Remove as holiday
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
