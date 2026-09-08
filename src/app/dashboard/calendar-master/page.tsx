"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { MasterHoliday } from "@/lib/sheets";
import ThaiFlagIcon from "@/components/ThaiFlagIcon";

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
  savedByDate,
  thaiByDate,
  onDayClick,
}: {
  year: number;
  monthNum: number;
  monthEn: string;
  savedByDate: Map<string, string>;
  thaiByDate: Map<string, string> | null;
  onDayClick: (
    date: string,
    savedLabel: string | undefined,
    thaiSuggestion: string | undefined
  ) => void;
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
          const savedLabel = savedByDate.get(date);
          const thaiLabel = thaiByDate?.get(date);
          const isSaved = savedLabel !== undefined;
          const isThaiOnly = !isSaved && thaiLabel !== undefined;
          // Thai overlay wins the displayed text on a coincident date, but
          // the saved-holiday (red) style still shows -- proof the saved
          // data is still there underneath, unaffected by the overlay.
          const displayLabel = isSaved ? (thaiLabel ?? savedLabel) : thaiLabel;
          return (
            <button
              key={idx}
              onClick={() => onDayClick(date, savedLabel, thaiLabel)}
              className={`aspect-square rounded text-[11px] leading-tight flex flex-col items-center justify-center ${
                isSaved
                  ? "bg-red-100 text-red-800 font-bold"
                  : isThaiOnly
                    ? "bg-amber-50 text-amber-700 border border-dashed border-amber-300"
                    : "hover:bg-gray-100 text-gray-700"
              }`}
              title={displayLabel || undefined}
            >
              <span>{day}</span>
              {displayLabel && (
                <span className="text-[7px] leading-none truncate w-full px-0.5">
                  {displayLabel}
                </span>
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
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // タイの祝日を表示 — a pure display overlay (fetched once, then just
  // toggled client-side), never written into MasterHolidays. Turning it
  // off always instantly restores exactly what's saved, since nothing was
  // ever changed underneath.
  const [showThaiHolidays, setShowThaiHolidays] = useState(false);
  const [thaiHolidays, setThaiHolidays] = useState<MasterHoliday[] | null>(null);
  const [thaiHolidaysLoading, setThaiHolidaysLoading] = useState(false);

  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllFinalStep, setDeleteAllFinalStep] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState<number | null>(null);

  // タイの祝日をインポート — unlike the display-only checkbox above, this
  // one actually writes into MasterHolidays: adds whichever Thai holidays
  // (within the fiscal year currently on screen) aren't saved yet, and
  // removes whichever saved holidays in that same range aren't on the
  // Thai list. A date present on both sides is left completely alone
  // (label included) -- import only reconciles which DATES are holidays,
  // never overwrites a label someone already customized.
  const [showImportModal, setShowImportModal] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importDiff, setImportDiff] = useState<{
    toAdd: MasterHoliday[];
    toRemove: MasterHoliday[];
  } | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importDone, setImportDone] = useState<{ added: number; removed: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function closeModal() {
    setEditing(null);
    setConfirmingRemove(false);
  }

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
  const thaiByDate = showThaiHolidays && thaiHolidays ? new Map(thaiHolidays.map((h) => [h.date, h.label])) : null;

  function handleDayClick(
    date: string,
    savedLabel: string | undefined,
    thaiSuggestion: string | undefined
  ) {
    if (savedLabel === undefined) {
      // not yet a holiday — open the popup to add one, pre-filled with the
      // Thai holiday's name if this date is only showing as a suggestion
      // (label still optional either way, OK with blank is fine)
      setEditing({ date, label: thaiSuggestion ?? "", isNew: true });
      return;
    }
    // already a holiday — open the manage popup (rename or remove), always
    // showing what's actually saved, even if the grid is currently
    // displaying a different Thai label overlaid on top of it
    setEditing({ date, label: savedLabel, isNew: false });
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
      closeModal();
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
      closeModal();
    } catch {
      setError("削除に失敗しました / Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  // Shared by the タイの祝日を表示 checkbox and the インポート button --
  // fetches the feed once and caches it in `thaiHolidays`; either caller
  // just awaits this and reads that state afterward instead of fetching
  // it separately.
  async function ensureThaiHolidaysLoaded(): Promise<MasterHoliday[]> {
    if (thaiHolidays !== null) return thaiHolidays;
    const res = await fetch("/api/calendar/master/thai-holidays");
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    const loaded: MasterHoliday[] = data.holidays ?? [];
    setThaiHolidays(loaded);
    return loaded;
  }

  async function handleToggleThai(checked: boolean) {
    setShowThaiHolidays(checked);
    if (!checked || thaiHolidays !== null) return; // already cached, or just turning it off
    setThaiHolidaysLoading(true);
    setError(null);
    try {
      await ensureThaiHolidaysLoaded();
    } catch {
      setError("タイの祝日の取得に失敗しました / Failed to load Thai holidays");
      setShowThaiHolidays(false);
    } finally {
      setThaiHolidaysLoading(false);
    }
  }

  // 現在表示中の年度（4月1日〜翌年3月31日）の範囲だけをインポート対象にする
  // -- 他の年度は一切触らない。
  function currentFiscalYearRange(): { start: string; end: string } {
    return {
      start: `${fiscalYearStart}-04-01`,
      end: `${fiscalYearStart + 1}-03-31`,
    };
  }

  async function openImportModal() {
    setShowImportModal(true);
    setImportDiff(null);
    setImportDone(null);
    setImportError(null);
    setImportLoading(true);
    try {
      const thai = await ensureThaiHolidaysLoaded();
      const { start, end } = currentFiscalYearRange();
      const inRange = (date: string) => date >= start && date <= end;

      const thaiInRange = thai.filter((h) => inRange(h.date));
      const masterInRange = holidays.filter((h) => inRange(h.date));
      const masterDates = new Set(masterInRange.map((h) => h.date));
      const thaiDates = new Set(thaiInRange.map((h) => h.date));

      const toAdd = thaiInRange.filter((h) => !masterDates.has(h.date));
      const toRemove = masterInRange.filter((h) => !thaiDates.has(h.date));
      setImportDiff({ toAdd, toRemove });
    } catch {
      setImportError("タイの祝日の取得に失敗しました / Failed to load Thai holidays");
    } finally {
      setImportLoading(false);
    }
  }

  async function confirmImport() {
    if (!importDiff) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const res = await fetch("/api/calendar/master/import-thai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toSet: importDiff.toAdd,
          toRemove: importDiff.toRemove.map((h) => h.date),
        }),
      });
      if (!res.ok) throw new Error("failed");
      setImportDone({ added: importDiff.toAdd.length, removed: importDiff.toRemove.length });
      setImportDiff(null);
      await load();
    } catch {
      setImportError("インポートに失敗しました / Failed to import");
    } finally {
      setImportApplying(false);
    }
  }

  function openDeleteAllModal() {
    setShowDeleteAllModal(true);
    setDeleteAllFinalStep(false);
    setDeleteAllDone(null);
    setError(null);
  }

  async function handleDeleteAll() {
    setDeletingAll(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/master", { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setHolidays([]);
      setDeleteAllDone(data.count ?? 0);
    } catch {
      setError("削除に失敗しました / Failed to delete");
    } finally {
      setDeletingAll(false);
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="flex items-center gap-2 rounded-full bg-blue-50 border border-blue-300 text-blue-700 px-5 py-2 text-sm font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showThaiHolidays}
              disabled={thaiHolidaysLoading}
              onChange={(e) => handleToggleThai(e.target.checked)}
              className="w-4 h-4 accent-blue-600 disabled:opacity-40"
            />
            <span>
              {thaiHolidaysLoading ? (
                "読み込み中... / Loading..."
              ) : (
                <>
                  <ThaiFlagIcon className="mr-1" />
                  タイの祝日を表示
                </>
              )}
              <span className="block text-[9px] font-normal opacity-70">Show Thai holidays</span>
            </span>
          </label>
          <button
            onClick={openImportModal}
            className="rounded-full bg-green-50 border border-green-300 text-green-700 px-5 py-2 text-sm font-semibold"
          >
            <ThaiFlagIcon className="mr-1" />
            📥 インポート（この年度）
            <span className="block text-[9px] font-normal opacity-70">
              Import Thai holidays (this fiscal year)
            </span>
          </button>
          <button
            onClick={openDeleteAllModal}
            className="rounded-full bg-red-50 border border-red-300 text-red-700 px-5 py-2 text-sm font-semibold"
          >
            🗑 全て削除
            <span className="block text-[9px] font-normal opacity-70">Delete All</span>
          </button>
          <Link
            href="/dashboard/admin-menu"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 戻る
            <span className="block text-[10px] font-normal opacity-70">Back</span>
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
      {showThaiHolidays && (
        <p className="text-xs text-amber-600 text-center">
          点線の黄色い日はタイの祝日（未登録）の候補です。保存済みの祝日（赤色）はそのまま残っています
          <span className="block">
            Dashed amber days are Thai holiday suggestions (not saved). Saved holidays (red) are
            unaffected
          </span>
        </p>
      )}

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
              savedByDate={holidayByDate}
              thaiByDate={thaiByDate}
              onDayClick={handleDayClick}
            />
          ))}
        </div>
      )}

      {editing && !confirmingRemove && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && closeModal()}
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
                onClick={closeModal}
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
                onClick={() => setConfirmingRemove(true)}
                disabled={saving}
                className="rounded-full border border-red-300 text-red-600 py-2.5 font-semibold disabled:opacity-40"
              >
                この日を祝日から外す / Remove as holiday
              </button>
            )}
          </div>
        </div>
      )}

      {editing && confirmingRemove && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && closeModal()}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {editing.date}
              <span className="block text-sm font-normal text-gray-500">
                本当にこの日を祝日から外しますか？
                <span className="block text-xs">Really remove this holiday?</span>
              </span>
              {editing.label && (
                <span className="block text-xs text-gray-400 mt-1">{editing.label}</span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmingRemove(false)}
                disabled={saving}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={removeHoliday}
                disabled={saving}
                className="rounded-full bg-red-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                外す / Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !deletingAll && setShowDeleteAllModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {deleteAllDone !== null ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  削除しました
                  <span className="block text-sm font-normal text-gray-500">Deleted</span>
                </h2>
                <p className="text-sm text-center text-gray-600">
                  祝日カレンダーの記録 {deleteAllDone}件を削除しました
                  <span className="block text-xs">Removed {deleteAllDone} holiday(s)</span>
                </p>
                <button
                  onClick={() => setShowDeleteAllModal(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : !deleteAllFinalStep ? (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  祝日カレンダーを全て削除
                  <span className="block text-sm font-normal text-gray-500">
                    Delete all Master holidays
                  </span>
                </h2>
                <div className="rounded-xl p-4 text-center bg-red-50 border border-red-300">
                  <p className="text-2xl font-bold text-red-600">{holidays.length}</p>
                  <p className="text-xs text-gray-500">
                    登録されている祝日の件数
                    <span className="block text-[10px] text-gray-400">Registered holidays</span>
                  </p>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  マスターの祝日を全て削除します。各クラスのカレンダーが独自に上書きしている日はそのまま残ります。よろしいですか？
                  <span className="block">
                    Deletes every Master holiday (all fiscal years). Any class-specific overrides
                    are unaffected. Continue?
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowDeleteAllModal(false)}
                    className="rounded-full bg-gray-100 text-gray-600 py-3 font-semibold"
                  >
                    キャンセル / Cancel
                  </button>
                  <button
                    onClick={() => setDeleteAllFinalStep(true)}
                    disabled={holidays.length === 0}
                    className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    次へ / Next
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  祝日カレンダーを全て削除
                  <span className="block text-sm font-normal text-gray-500">
                    Delete all Master holidays
                  </span>
                </h2>
                <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                  <p className="text-sm text-red-800 font-semibold text-center">
                    ⚠ この削除は完全に永久的です。バックアップはなく、二度と復元できません
                    <span className="block text-xs font-normal mt-1">
                      This deletion is permanent — there is no backup and it can never be
                      recovered.
                    </span>
                  </p>
                </div>
                {error && <p className="text-red-600 text-sm text-center">{error}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDeleteAllFinalStep(false)}
                    disabled={deletingAll}
                    className="rounded-full bg-gray-100 text-gray-600 py-3 font-semibold disabled:opacity-40"
                  >
                    戻る / Back
                  </button>
                  <button
                    onClick={handleDeleteAll}
                    disabled={deletingAll}
                    className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    {deletingAll ? "削除中... / Deleting..." : "本当に削除する / Really delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !importApplying && setShowImportModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {importDone !== null ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  インポートしました
                  <span className="block text-sm font-normal text-gray-500">Imported</span>
                </h2>
                <p className="text-sm text-center text-gray-600">
                  追加 {importDone.added}件 / 削除 {importDone.removed}件
                  <span className="block text-xs">
                    Added {importDone.added} / Removed {importDone.removed}
                  </span>
                </p>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center">
                  <ThaiFlagIcon className="mr-1" />
                  タイの祝日をインポート
                  <span className="block text-sm font-normal text-gray-500">
                    Import Thai holidays
                  </span>
                </h2>
                <p className="text-xs text-gray-400 text-center -mt-2">
                  {fiscalYearStart}年度（{fiscalYearStart}年4月〜{fiscalYearStart + 1}年3月）の範囲だけが対象です
                  <span className="block">
                    Only the {fiscalYearStart} fiscal year (currently shown) is affected
                  </span>
                </p>

                {importLoading ? (
                  <p className="text-gray-500 text-sm text-center">
                    読み込み中... / Loading...
                  </p>
                ) : importError ? (
                  <p className="text-red-600 text-sm text-center">{importError}</p>
                ) : importDiff && importDiff.toAdd.length === 0 && importDiff.toRemove.length === 0 ? (
                  <p className="text-sm text-center text-gray-600">
                    すでにタイの祝日と一致しています。変更はありません
                    <span className="block text-xs">
                      Already matches the Thai holiday list — nothing to change
                    </span>
                  </p>
                ) : (
                  importDiff && (
                    <div className="flex flex-col gap-3 text-sm">
                      {importDiff.toAdd.length > 0 && (
                        <div>
                          <p className="text-green-700 font-semibold text-xs mb-1">
                            ＋ 追加 {importDiff.toAdd.length}件 / Add {importDiff.toAdd.length}
                          </p>
                          <ul className="flex flex-col gap-0.5">
                            {importDiff.toAdd.map((h) => (
                              <li
                                key={h.date}
                                className="text-xs bg-green-50 text-green-800 rounded-lg px-2 py-1 flex justify-between gap-2"
                              >
                                <span>{h.date}</span>
                                <span className="truncate">{h.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {importDiff.toRemove.length > 0 && (
                        <div>
                          <p className="text-red-600 font-semibold text-xs mb-1">
                            − 削除 {importDiff.toRemove.length}件 / Remove{" "}
                            {importDiff.toRemove.length}
                          </p>
                          <ul className="flex flex-col gap-0.5">
                            {importDiff.toRemove.map((h) => (
                              <li
                                key={h.date}
                                className="text-xs bg-red-50 text-red-700 rounded-lg px-2 py-1 flex justify-between gap-2"
                              >
                                <span>{h.date}</span>
                                <span className="truncate">{h.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowImportModal(false)}
                    disabled={importApplying}
                    className="rounded-full bg-gray-100 text-gray-600 py-3 font-semibold disabled:opacity-40"
                  >
                    キャンセル / Cancel
                  </button>
                  <button
                    onClick={confirmImport}
                    disabled={
                      importApplying ||
                      importLoading ||
                      !importDiff ||
                      (importDiff.toAdd.length === 0 && importDiff.toRemove.length === 0)
                    }
                    className="rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    {importApplying ? "インポート中... / Importing..." : "インポートする / Import"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
