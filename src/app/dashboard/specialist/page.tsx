"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToBranchGrade, type GradeShort } from "@/lib/classes";
import type { SpecialistCategory } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const GRADES: GradeShort[] = ["長", "中", "少"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function cellKey(categoryId: string, grade: string) {
  return `${categoryId}|${grade}`;
}

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
  // All 3 grades are loaded (not just this tablet's own) so the table can
  // show the whole branch's picture — only this tablet's own grade row is
  // editable, the rest are shown read-only/grayed out for context.
  const [checkedDates, setCheckedDates] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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
      const [categoriesRes, attendanceRes] = await Promise.all([
        fetch(`/api/specialist/categories?branch=${encodeURIComponent(branch)}`),
        fetch(
          `/api/specialist/attendance?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
        ),
      ]);
      if (!categoriesRes.ok || !attendanceRes.ok) throw new Error("failed");
      const categoriesData = await categoriesRes.json();
      const attendanceData = await attendanceRes.json();
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
    } catch {
      setError("データの取得に失敗しました");
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
    const isChecked = checkedDates[key]?.has(date) ?? false;
    const next = !isChecked;
    const savingId = `${key}|${date}`;

    // Removing a checkmark is easy to do by accident and this page is
    // usually only opened once a month, so a mistaken uncheck could sit
    // unnoticed for weeks — confirm before actually removing it. Adding a
    // new checkmark stays a single tap, no confirm needed.
    if (isChecked) {
      const categoryName = categories.find((c) => c.categoryId === categoryId)?.name ?? "";
      if (!window.confirm(`「${categoryName}」${date} のチェックを外しますか？`)) {
        return;
      }
    }

    // optimistic update
    setCheckedDates((prev) => {
      const copy = { ...prev };
      const set = new Set(copy[key] ?? []);
      if (next) set.add(date);
      else set.delete(date);
      copy[key] = set;
      return copy;
    });
    setSavingKey(savingId);
    setError(null);
    try {
      const res = await fetch("/api/specialist/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, categoryId, grade: myGrade, date, checked: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setError("保存に失敗しました");
      // revert
      setCheckedDates((prev) => {
        const copy = { ...prev };
        const set = new Set(copy[key] ?? []);
        if (isChecked) set.add(date);
        else set.delete(date);
        copy[key] = set;
        return copy;
      });
    } finally {
      setSavingKey(null);
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
      setError("名前の保存に失敗しました");
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
      setError("項目の追加に失敗しました");
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
        `「${name}」を削除しますか？\n\n${branch}の年長・年中・年少すべてから消えます（他の学年のタブレットからも見えなくなります）。過去のチェック記録はシート上に残りますが、非表示になります。`
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
      setError("削除に失敗しました");
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
          <p className="text-sm text-gray-500">
            編集できるのは{myGrade}の行だけです（{selectedClass}）。他の学年はグレー表示（閲覧のみ）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full border border-gray-300 text-gray-700 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={goPrevMonth}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="前の月"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-32 text-center">
          {year}年{month}月
        </p>
        <button
          onClick={goNextMonth}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="次の月"
        >
          ▶
        </button>
      </div>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-28">
                  項目
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
                      className={`border border-gray-300 px-1 py-1 text-center w-8 ${
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
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={dayNumbers.length + 3}
                    className="text-center text-gray-400 text-sm py-6 border border-gray-300"
                  >
                    まだ項目がありません。下から追加してください。
                  </td>
                </tr>
              ) : (
                categories.map((c, ci) => {
                  const zebra = ci % 2 === 1;
                  return (
                    <Fragment key={c.categoryId}>
                      {GRADES.map((g, gi) => {
                        const isMine = g === myGrade;
                        const key = cellKey(c.categoryId, g);
                        const dates = checkedDates[key] ?? new Set<string>();
                        const count = dates.size;
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
                              const savingId = `${key}|${date}`;
                              const isSaving = savingKey === savingId;
                              return (
                                <td
                                  key={day}
                                  className={`text-center border border-gray-300 py-1 ${
                                    isWeekend && isMine ? "bg-orange-50/60" : ""
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={!isMine || isSaving}
                                    onChange={
                                      isMine ? () => toggleChecked(c.categoryId, date) : undefined
                                    }
                                    className={
                                      isMine
                                        ? "w-4 h-4 accent-green-600 cursor-pointer"
                                        : "w-4 h-4 accent-gray-300 opacity-60 cursor-not-allowed"
                                    }
                                  />
                                </td>
                              );
                            })}
                            <td
                              className={`text-center border border-gray-300 font-semibold ${
                                isMine ? "text-green-700" : "text-gray-400"
                              }`}
                            >
                              {count > 0 ? count : ""}
                            </td>
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
          placeholder="新しい項目名（例：体操）"
          disabled={addingCategory}
          className="rounded-full border border-gray-300 px-4 py-2 text-sm w-56"
        />
        <button
          onClick={addCategory}
          disabled={addingCategory || !newCategoryName.trim()}
          className="rounded-full bg-black text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          ＋ 追加
        </button>
      </div>
    </main>
  );
}
