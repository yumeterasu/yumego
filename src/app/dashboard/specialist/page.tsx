"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import {
  classNameToBranchGrade,
  branchGradeToClassName,
  type GradeShort,
} from "@/lib/classes";
import type { AttendanceStatus, SpecialistCategory } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const GRADES: GradeShort[] = ["長", "中", "少"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function countsAsPresent(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "early_leave";
}

function cellKey(categoryId: string, grade: string, date?: string) {
  return date ? `${categoryId}|${grade}|${date}` : `${categoryId}|${grade}`;
}

// Combines what used to be two separate pages (専門コーチ予定 / 専門コーチ人数)
// into one table: each day cell has a checkbox, plus — only once checked —
// an optional participant-count input right under it. Unchecking always
// clears any count that cell had too, so "unchecked" and "no number" never
// drift apart the way they could when these lived on separate pages.
export default function SpecialistCoachPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();
  // classNameToBranchGrade returns a fresh object every call — memoize so
  // the effect below (which depends on it) doesn't see a "new" value and
  // refetch on every render, which was causing an infinite fetch loop.
  const branchGrade = useMemo(
    () => (selectedClass ? classNameToBranchGrade(selectedClass) : null),
    [selectedClass]
  );

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [categories, setCategories] = useState<SpecialistCategory[]>([]);
  // "categoryId|grade" -> Set of checked "YYYY-MM-DD" dates, this branch+month.
  const [checkedDates, setCheckedDates] = useState<Record<string, Set<string>>>({});
  // "categoryId|grade" -> total present that day, for every grade in the
  // branch (needed to show/cap against every row, not just this tablet's).
  const [presentTotals, setPresentTotals] = useState<Record<string, Record<string, number>>>({});
  // "categoryId|grade|date" -> participant count, last confirmed saved.
  const savedCountsRef = useRef<Record<string, number>>({});
  // Same shape, but the live input text (may be mid-edit, unsaved).
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A cell being toggled (checkbox) or committed (count) — either one
  // disables just that cell's inputs while its request is in flight.
  const [busyCellKey, setBusyCellKey] = useState<string | null>(null);

  // Live-edited category names, kept separate from `categories` (which
  // only updates once a rename is confirmed saved) — comparing a draft to
  // its own live-mutated state would always look "unchanged" and silently
  // skip the save (see the チェック label header bug this mirrors).
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [savingNameId, setSavingNameId] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  const yearMonth = `${year}-${pad2(month)}`;
  const branch = branchGrade?.branch ?? "";
  const myGrade = branchGrade?.grade ?? "";

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError(null);
    try {
      const [categoriesRes, attendanceRes, participationRes, ...classAttendanceResList] =
        await Promise.all([
          fetch(`/api/specialist/categories?branch=${encodeURIComponent(branch)}`),
          fetch(
            `/api/specialist/attendance?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
          ),
          fetch(
            `/api/specialist/participation?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
          ),
          ...GRADES.map((g) =>
            fetch(
              `/api/attendance?class=${encodeURIComponent(
                branchGradeToClassName(branch as "プロンポン" | "トンロー", g)
              )}&month=${yearMonth}`
            )
          ),
        ]);
      if (
        !categoriesRes.ok ||
        !attendanceRes.ok ||
        !participationRes.ok ||
        classAttendanceResList.some((r) => !r.ok)
      ) {
        throw new Error("failed");
      }
      const categoriesData = await categoriesRes.json();
      const attendanceData = await attendanceRes.json();
      const participationData = await participationRes.json();
      const loadedCategories: SpecialistCategory[] = categoriesData.categories ?? [];
      setCategories(loadedCategories);
      setNameDrafts(
        Object.fromEntries(loadedCategories.map((c) => [c.categoryId, c.name]))
      );

      const cells: { categoryId: string; grade: string; date: string }[] =
        attendanceData.cells ?? [];
      const next: Record<string, Set<string>> = {};
      for (const cell of cells) {
        const key = cellKey(cell.categoryId, cell.grade);
        if (!next[key]) next[key] = new Set();
        next[key].add(cell.date);
      }
      setCheckedDates(next);

      // Present totals per grade+date, from the real attendance sheet.
      const totals: Record<string, Record<string, number>> = {};
      for (let i = 0; i < GRADES.length; i++) {
        const g = GRADES[i];
        const data = await classAttendanceResList[i].json();
        const records: { date: string; status: AttendanceStatus }[] = data.records ?? [];
        const byDate: Record<string, number> = {};
        for (const r of records) {
          if (!countsAsPresent(r.status)) continue;
          byDate[r.date] = (byDate[r.date] ?? 0) + 1;
        }
        totals[g] = byDate;
      }
      setPresentTotals(totals);

      const participationCells: {
        categoryId: string;
        grade: string;
        date: string;
        count: number;
      }[] = participationData.cells ?? [];
      const saved: Record<string, number> = {};
      for (const cell of participationCells) {
        saved[cellKey(cell.categoryId, cell.grade, cell.date)] = cell.count;
      }
      savedCountsRef.current = saved;
      setDraftCounts(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v)])));
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [branch, yearMonth]);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass || !branchGrade) {
      router.replace("/select-class");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass, branchGrade, router, load]);

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

  async function toggleChecked(categoryId: string, date: string) {
    const key = cellKey(categoryId, myGrade);
    const countKey = cellKey(categoryId, myGrade, date);
    const isChecked = checkedDates[key]?.has(date) ?? false;
    const next = !isChecked;
    const existingCount = savedCountsRef.current[countKey];

    // Unchecking is confirmed every single time, whether or not a count was
    // ever entered — it's easy to tap by accident, this page is usually
    // only opened a few times a month, and unchecking also silently clears
    // any participant count already saved for that day.
    if (isChecked) {
      const categoryName = categories.find((c) => c.categoryId === categoryId)?.name ?? "";
      if (
        !window.confirm(
          `「${categoryName}」${date} のチェックを外しますか？\n入力していた参加人数があれば、それも削除されます。\n\nRemove the checkmark for "${categoryName}" on ${date}? Any participant count entered for that day will be deleted too.`
        )
      ) {
        return;
      }
    }

    // optimistic update — checkbox
    setCheckedDates((prev) => {
      const copy = { ...prev };
      const set = new Set(copy[key] ?? []);
      if (next) set.add(date);
      else set.delete(date);
      copy[key] = set;
      return copy;
    });
    // optimistic update — clear the count too when unchecking
    if (!next) {
      setDraftCounts((prev) => ({ ...prev, [countKey]: "" }));
    }
    setBusyCellKey(countKey);
    setError(null);
    try {
      const attendanceReq = fetch("/api/specialist/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, categoryId, grade: myGrade, date, checked: next }),
      });
      const participationReq =
        !next && existingCount !== undefined
          ? fetch("/api/specialist/participation", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                branch,
                categoryId,
                grade: myGrade,
                date,
                count: null,
              }),
            })
          : null;
      const results = await Promise.all([attendanceReq, participationReq]);
      if (!results[0].ok || (results[1] && !results[1].ok)) throw new Error("failed");
      if (!next) delete savedCountsRef.current[countKey];
    } catch {
      setError("保存に失敗しました / Failed to save");
      // revert both the checkbox and the count
      setCheckedDates((prev) => {
        const copy = { ...prev };
        const set = new Set(copy[key] ?? []);
        if (isChecked) set.add(date);
        else set.delete(date);
        copy[key] = set;
        return copy;
      });
      setDraftCounts((prev) => ({
        ...prev,
        [countKey]: existingCount !== undefined ? String(existingCount) : "",
      }));
    } finally {
      setBusyCellKey(null);
    }
  }

  async function commitCount(categoryId: string, date: string, rawValue: string, total: number) {
    const key = cellKey(categoryId, myGrade, date);
    const original = savedCountsRef.current[key];

    const trimmed = rawValue.trim();
    let parsed: number | null = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setDraftCounts((prev) => ({
        ...prev,
        [key]: original !== undefined ? String(original) : "",
      }));
      return;
    }
    if (parsed !== null) {
      parsed = Math.floor(parsed);
      if (parsed > total) parsed = total; // can't have more participants than kids present
    }

    if (parsed === (original ?? null)) {
      setDraftCounts((prev) => ({ ...prev, [key]: parsed === null ? "" : String(parsed) }));
      return;
    }

    // Number inputs misfire easily (scroll wheel, stray taps on the
    // up/down arrows) — confirm before actually writing a real change.
    const categoryName = categories.find((c) => c.categoryId === categoryId)?.name ?? "";
    const fromLabel = original === undefined ? "未入力" : String(original);
    const toLabel = parsed === null ? "未入力" : String(parsed);
    if (
      !window.confirm(
        `「${categoryName}」${date} の参加人数を ${fromLabel} → ${toLabel} に変更しますか？\nChange the participant count for "${categoryName}" on ${date} from ${fromLabel} to ${toLabel}?`
      )
    ) {
      setDraftCounts((prev) => ({
        ...prev,
        [key]: original !== undefined ? String(original) : "",
      }));
      return;
    }

    setBusyCellKey(key);
    setError(null);
    try {
      const res = await fetch("/api/specialist/participation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, categoryId, grade: myGrade, date, count: parsed }),
      });
      if (!res.ok) throw new Error("failed");
      if (parsed === null) {
        delete savedCountsRef.current[key];
      } else {
        savedCountsRef.current[key] = parsed;
      }
      setDraftCounts((prev) => ({ ...prev, [key]: parsed === null ? "" : String(parsed) }));
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDraftCounts((prev) => ({
        ...prev,
        [key]: original !== undefined ? String(original) : "",
      }));
    } finally {
      setBusyCellKey(null);
    }
  }

  async function saveNameEdit(categoryId: string, value: string) {
    const original = categories.find((c) => c.categoryId === categoryId)?.name ?? "";
    if (value === original || !value.trim()) {
      setNameDrafts((prev) => ({ ...prev, [categoryId]: original }));
      return;
    }
    setSavingNameId(categoryId);
    setError(null);
    try {
      const res = await fetch("/api/specialist/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, name: value }),
      });
      if (!res.ok) throw new Error("failed");
      setCategories((prev) =>
        prev.map((c) => (c.categoryId === categoryId ? { ...c, name: value } : c))
      );
    } catch {
      setError("名前の保存に失敗しました / Failed to save the name");
      setNameDrafts((prev) => ({ ...prev, [categoryId]: original }));
    } finally {
      setSavingNameId(null);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name || !branch) return;
    setAddingCategory(true);
    setError(null);
    try {
      const res = await fetch("/api/specialist/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, name }),
      });
      if (!res.ok) throw new Error("failed");
      const { categoryId } = await res.json();
      setCategories((prev) => [...prev, { categoryId, branch, name }]);
      setNameDrafts((prev) => ({ ...prev, [categoryId]: name }));
      setNewCategoryName("");
    } catch {
      setError("項目の追加に失敗しました / Failed to add item");
    } finally {
      setAddingCategory(false);
    }
  }

  async function deleteCategory(categoryId: string, name: string) {
    // Categories are shared branch-wide (this is one row spanning all 3
    // grades, same as the reference sheet) — make that blast radius
    // explicit here, since deleting from a 年長 tablet also removes it
    // from 年中/年少 of the same branch, not just this screen.
    if (
      !window.confirm(
        `「${name}」を削除しますか？\n\n${branch}の年長・年中・年少すべてから消えます（他の学年の画面からも見えなくなります）。過去の記録はシート上に残りますが、非表示になります。\n\nDelete "${name}"? This removes it from all of ${branch}'s 長/中/少 (other grades will no longer see it either). Past records stay in the sheet but will be hidden.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/specialist/categories?categoryId=${encodeURIComponent(categoryId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("failed");
      setCategories((prev) => prev.filter((c) => c.categoryId !== categoryId));
    } catch {
      setError("削除に失敗しました / Failed to delete");
    }
  }

  if (!loaded || !selectedClass || !branchGrade) return null;

  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{branch} 専門コーチ</h1>
          <p className="text-xs text-gray-400">{branch} Specialist Coach</p>
          <p className="text-sm text-gray-500">
            編集できるのは{myGrade}の行だけです（{selectedClass}）。チェックした日だけ人数を入力できます
            <span className="block text-xs">
              Only the {myGrade} row is editable ({selectedClass}). The count can only be
              entered on days that are checked
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
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-28">
                  項目
                  <span className="block text-[9px] font-normal text-gray-400">Item</span>
                </th>
                <th className="sticky left-28 bg-gray-100 border border-gray-300 px-2 py-1 text-center whitespace-nowrap z-10 w-10">
                  学年
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-1 py-1 text-center w-11 ${
                        isWeekend ? "bg-orange-50 text-orange-700" : "bg-gray-50"
                      }`}
                    >
                      <div>{day}</div>
                      <div className="text-[10px] font-normal">
                        {WEEKDAY_LABELS[dow]}
                      </div>
                    </th>
                  );
                })}
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-14 whitespace-nowrap">
                  回数
                  <span className="block text-[9px] font-normal">Days</span>
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-14 whitespace-nowrap">
                  人数計
                  <span className="block text-[9px] font-normal">Total</span>
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-emerald-100 text-emerald-900 w-16 whitespace-nowrap">
                  全学年
                  <br />
                  合計
                  <span className="block text-[9px] font-normal">All Grades</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={dayNumbers.length + 5}
                    className="text-center text-gray-400 text-sm py-6 border border-gray-300"
                  >
                    まだ項目がありません。下から追加してください。
                    <span className="block text-xs">No items yet — add one below</span>
                  </td>
                </tr>
              ) : (
                categories.map((c, ci) => {
                  const zebra = ci % 2 === 1;

                  // Precompute each grade's monthly participant total up
                  // front (not just "my" grade) so they can be summed into
                  // a single combined 長+中+少 total for this category alone.
                  const gradeCountTotals: Record<GradeShort, number> = { 長: 0, 中: 0, 少: 0 };
                  for (const g of GRADES) {
                    for (const day of dayNumbers) {
                      const date = `${year}-${pad2(month)}-${pad2(day)}`;
                      const key = cellKey(c.categoryId, g, date);
                      if (g === myGrade) {
                        const draft = draftCounts[key] ?? "";
                        if (draft !== "") gradeCountTotals[g] += Number(draft) || 0;
                      } else {
                        const saved = savedCountsRef.current[key];
                        if (saved !== undefined) gradeCountTotals[g] += saved;
                      }
                    }
                  }
                  const categoryCountTotal = GRADES.reduce(
                    (sum, g) => sum + gradeCountTotals[g],
                    0
                  );

                  return (
                    <Fragment key={c.categoryId}>
                      {GRADES.map((g, gi) => {
                        const isMine = g === myGrade;
                        const key = cellKey(c.categoryId, g);
                        const dates = checkedDates[key] ?? new Set<string>();
                        const daysCount = dates.size;
                        const countTotal = gradeCountTotals[g];
                        return (
                          <tr
                            key={`${c.categoryId}-${g}`}
                            className={isMine ? "bg-green-50/60" : zebra ? "bg-gray-50/50" : ""}
                          >
                            {gi === 0 && (
                              <td
                                rowSpan={GRADES.length}
                                className={`sticky left-0 border border-gray-300 px-2 py-1 whitespace-nowrap align-top ${
                                  zebra ? "bg-gray-50" : "bg-white"
                                }`}
                              >
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={nameDrafts[c.categoryId] ?? ""}
                                    disabled={savingNameId === c.categoryId}
                                    onChange={(e) =>
                                      setNameDrafts((prev) => ({
                                        ...prev,
                                        [c.categoryId]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    onBlur={(e) => saveNameEdit(c.categoryId, e.target.value)}
                                    className="w-20 bg-transparent outline-none focus:bg-blue-50 rounded px-1"
                                  />
                                  <button
                                    onClick={() => deleteCategory(c.categoryId, c.name)}
                                    aria-label={`${c.name}を削除`}
                                    className="text-gray-300 hover:text-red-500 text-xs px-1"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </td>
                            )}
                            <td
                              className={`sticky left-28 border border-gray-300 px-2 py-1 text-center whitespace-nowrap ${
                                isMine ? "bg-green-50/60 font-bold text-green-800" : zebra ? "bg-gray-50" : "bg-white"
                              }`}
                            >
                              {g}
                            </td>
                            {dayNumbers.map((day) => {
                              const date = `${year}-${pad2(month)}-${pad2(day)}`;
                              const dow = new Date(year, month - 1, day).getDay();
                              const isWeekend = dow === 0 || dow === 6;
                              const isChecked = dates.has(date);
                              const total = presentTotals[g]?.[date] ?? 0;
                              const countKey = cellKey(c.categoryId, g, date);
                              const isBusy = busyCellKey === countKey;

                              if (!isMine) {
                                const saved = savedCountsRef.current[countKey];
                                return (
                                  <td
                                    key={day}
                                    className={`text-center border border-gray-300 py-1 ${
                                      isWeekend ? "bg-orange-50/40" : ""
                                    }`}
                                  >
                                    <div className="flex flex-col items-center gap-0.5 opacity-70">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        disabled
                                        className="w-3.5 h-3.5 accent-gray-300 cursor-not-allowed"
                                      />
                                      {isChecked && (
                                        <span className="text-[9px] text-gray-400">
                                          {saved !== undefined ? saved : ""}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                              }

                              const draft = draftCounts[countKey] ?? "";
                              // Deliberately also disabled when total===0 (no
                              // 出席 recorded for this class/date yet) — the
                              // headcount is "participants out of kids
                              // present," so it can't mean anything until
                              // today's attendance has actually been taken.
                              const countDisabled = !isChecked || total === 0 || isBusy;

                              return (
                                <td
                                  key={day}
                                  className={`text-center border border-gray-300 py-1 ${
                                    isWeekend ? "bg-orange-50/60" : ""
                                  }`}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isBusy}
                                      onChange={() => toggleChecked(c.categoryId, date)}
                                      className="w-3.5 h-3.5 accent-green-600 cursor-pointer"
                                    />
                                    {isChecked && (
                                      <div className="flex items-center gap-0.5 whitespace-nowrap">
                                        <input
                                          type="number"
                                          min={0}
                                          max={total}
                                          value={draft}
                                          disabled={countDisabled}
                                          placeholder={total === 0 ? "-" : "0"}
                                          onChange={(e) =>
                                            setDraftCounts((prev) => ({
                                              ...prev,
                                              [countKey]: e.target.value,
                                            }))
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") e.currentTarget.blur();
                                          }}
                                          onBlur={(e) =>
                                            commitCount(c.categoryId, date, e.target.value, total)
                                          }
                                          className="w-6 bg-transparent text-center text-[11px] outline-none focus:bg-white/60 rounded disabled:text-gray-300"
                                        />
                                        {total > 0 && (
                                          <span className="text-gray-400 text-[9px]">
                                            /{total}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td
                              className={`text-center border border-gray-300 font-semibold ${
                                isMine ? "text-green-700" : "text-gray-400"
                              }`}
                            >
                              {daysCount > 0 ? daysCount : ""}
                            </td>
                            <td
                              className={`text-center border border-gray-300 font-semibold ${
                                isMine ? "text-green-700" : "text-gray-400"
                              }`}
                            >
                              {countTotal > 0 ? countTotal : ""}
                            </td>
                            {gi === 0 && (
                              <td
                                rowSpan={GRADES.length}
                                className="text-center border border-gray-300 font-bold text-emerald-800 bg-emerald-50 align-middle"
                              >
                                {categoryCountTotal > 0 ? categoryCountTotal : ""}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 self-center">
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCategory();
          }}
          placeholder="新しい項目名（例：体操）/ New item name (e.g. Gymnastics)"
          disabled={addingCategory}
          className="rounded-full border border-gray-300 px-4 py-2 text-sm w-56"
        />
        <button
          onClick={addCategory}
          disabled={addingCategory || !newCategoryName.trim()}
          className="rounded-full bg-green-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          ＋ 追加 / Add
        </button>
      </div>
    </main>
  );
}
