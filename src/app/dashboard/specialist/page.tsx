"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToBranchGrade } from "@/lib/classes";
import type { SpecialistCategory } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function SpecialistCoachPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();
  const branchGrade = selectedClass ? classNameToBranchGrade(selectedClass) : null;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [categories, setCategories] = useState<SpecialistCategory[]>([]);
  // categoryId -> Set of checked "YYYY-MM-DD" dates, this branch+grade+month
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
  const grade = branchGrade?.grade ?? "";

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
        if (cell.grade !== grade) continue;
        if (!next[cell.categoryId]) next[cell.categoryId] = new Set();
        next[cell.categoryId].add(cell.date);
      }
      setCheckedDates(next);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [branch, grade, yearMonth]);

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
    const isChecked = checkedDates[categoryId]?.has(date) ?? false;
    const next = !isChecked;
    const key = `${categoryId}|${date}`;

    // optimistic update
    setCheckedDates((prev) => {
      const copy = { ...prev };
      const set = new Set(copy[categoryId] ?? []);
      if (next) set.add(date);
      else set.delete(date);
      copy[categoryId] = set;
      return copy;
    });
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/specialist/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, categoryId, grade, date, checked: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setError("保存に失敗しました");
      // revert
      setCheckedDates((prev) => {
        const copy = { ...prev };
        const set = new Set(copy[categoryId] ?? []);
        if (isChecked) set.add(date);
        else set.delete(date);
        copy[categoryId] = set;
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
    if (!window.confirm(`「${name}」を削除しますか？(この項目のチェックは表示されなくなります)`)) {
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
          <h1 className="text-xl font-bold">
            {branch} 専門コーチ
          </h1>
          <p className="text-sm text-gray-500">対象学年：{grade}（{selectedClass}）</p>
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
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-32">
                  項目
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
                    colSpan={dayNumbers.length + 2}
                    className="text-center text-gray-400 text-sm py-6 border border-gray-300"
                  >
                    まだ項目がありません。下から追加してください。
                  </td>
                </tr>
              ) : (
                categories.map((c, i) => {
                  const dates = checkedDates[c.categoryId] ?? new Set<string>();
                  const count = dates.size;
                  return (
                    <tr key={c.categoryId} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                      <td
                        className={`sticky left-0 border border-gray-300 px-2 py-1 whitespace-nowrap ${
                          i % 2 === 1 ? "bg-gray-50" : "bg-white"
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
                            className="w-24 bg-transparent outline-none focus:bg-blue-50 rounded px-1"
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
                      {dayNumbers.map((day) => {
                        const date = `${year}-${pad2(month)}-${pad2(day)}`;
                        const dow = new Date(year, month - 1, day).getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        const isChecked = dates.has(date);
                        const key = `${c.categoryId}|${date}`;
                        const isSaving = savingKey === key;
                        return (
                          <td
                            key={day}
                            className={`text-center border border-gray-300 py-1 ${
                              isWeekend ? "bg-orange-50/60" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isSaving}
                              onChange={() => toggleChecked(c.categoryId, date)}
                              className="w-4 h-4 accent-green-600 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                      <td className="text-center border border-gray-300 font-semibold text-green-700">
                        {count > 0 ? count : ""}
                      </td>
                    </tr>
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
