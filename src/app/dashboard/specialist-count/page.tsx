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

function cellKey(categoryId: string, grade: string, date: string) {
  return `${categoryId}|${grade}|${date}`;
}

export default function SpecialistCountPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();
  const branchGrade = useMemo(
    () => (selectedClass ? classNameToBranchGrade(selectedClass) : null),
    [selectedClass]
  );

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [categories, setCategories] = useState<SpecialistCategory[]>([]);
  // "categoryId|grade" -> total present that day, for every grade in the
  // branch (needed to show/cap against every row, not just this tablet's).
  const [presentTotals, setPresentTotals] = useState<Record<string, Record<string, number>>>({});
  // "categoryId|grade|date" -> participant count, last confirmed saved.
  const savedCountsRef = useRef<Record<string, number>>({});
  // Same shape, but the live input text (may be mid-edit, unsaved).
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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
      const [categoriesRes, participationRes, ...attendanceResList] = await Promise.all([
        fetch(`/api/specialist/categories?branch=${encodeURIComponent(branch)}`),
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
      if (!categoriesRes.ok || !participationRes.ok || attendanceResList.some((r) => !r.ok)) {
        throw new Error("failed");
      }
      const categoriesData = await categoriesRes.json();
      const participationData = await participationRes.json();
      const loadedCategories: SpecialistCategory[] = categoriesData.categories ?? [];
      setCategories(loadedCategories);
      setNameDrafts(
        Object.fromEntries(loadedCategories.map((c) => [c.categoryId, c.name]))
      );

      // Present totals per grade+date, from the real attendance sheet.
      const totals: Record<string, Record<string, number>> = {};
      for (let i = 0; i < GRADES.length; i++) {
        const g = GRADES[i];
        const data = await attendanceResList[i].json();
        const records: { date: string; status: AttendanceStatus }[] = data.records ?? [];
        const byDate: Record<string, number> = {};
        for (const r of records) {
          if (!countsAsPresent(r.status)) continue;
          byDate[r.date] = (byDate[r.date] ?? 0) + 1;
        }
        totals[g] = byDate;
      }
      setPresentTotals(totals);

      const cells: { categoryId: string; grade: string; date: string; count: number }[] =
        participationData.cells ?? [];
      const saved: Record<string, number> = {};
      for (const cell of cells) {
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

  async function commitCount(categoryId: string, date: string, rawValue: string, total: number) {
    const key = cellKey(categoryId, myGrade, date);
    const original = savedCountsRef.current[key];

    const trimmed = rawValue.trim();
    let parsed: number | null = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      // not a valid number — revert the draft, don't save
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

    setSavingKey(key);
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
    if (
      !window.confirm(
        `「${name}」を削除しますか？\n\n${branch}の年長・年中・年少すべてから消えます（他の学年のタブレットからも見えなくなります）。過去の記録はシート上に残りますが、非表示になります。\n\nDelete "${name}"? This removes it from all of ${branch}'s 長/中/少 (other tablets in this branch will no longer see it). Past records stay in the sheet but will be hidden.`
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
          <h1 className="text-xl font-bold">{branch} 専門コーチ人数</h1>
          <p className="text-xs text-gray-400">{branch} Specialist Coach Headcount</p>
          <p className="text-sm text-gray-500">
            入力できるのは{myGrade}の行だけです（{selectedClass}）。数字は「参加人数／その日の出席人数」
            <span className="block text-xs">
              Only the {myGrade} row is editable ({selectedClass}). Numbers are
              &quot;participants / attendees that day&quot;
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full border border-gray-300 text-gray-700 px-4 py-2.5 text-sm font-semibold"
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
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="前の月 / Previous month"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-32 text-center">
          {year}年{month}月
        </p>
        <button
          onClick={goNextMonth}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
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
                      className={`border border-gray-300 px-1 py-1 text-center w-14 ${
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
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-16 whitespace-nowrap">
                  合計
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
                    colSpan={dayNumbers.length + 4}
                    className="text-center text-gray-400 text-sm py-6 border border-gray-300"
                  >
                    まだ項目がありません。下から追加してください。
                    <span className="block text-xs">No items yet — add one below</span>
                  </td>
                </tr>
              ) : (
                categories.map((c, ci) => {
                  const zebra = ci % 2 === 1;

                  // Precompute each grade's monthly total up front (not
                  // just "my" grade) so they can be summed into a single
                  // combined 長+中+少 total for this category alone —
                  // other categories never feed into it.
                  const gradeMonthTotals: Record<GradeShort, number> = {
                    長: 0,
                    中: 0,
                    少: 0,
                  };
                  for (const g of GRADES) {
                    for (const day of dayNumbers) {
                      const date = `${year}-${pad2(month)}-${pad2(day)}`;
                      const key = cellKey(c.categoryId, g, date);
                      if (g === myGrade) {
                        const draft = draftCounts[key] ?? "";
                        if (draft !== "") gradeMonthTotals[g] += Number(draft) || 0;
                      } else {
                        const saved = savedCountsRef.current[key];
                        if (saved !== undefined) gradeMonthTotals[g] += saved;
                      }
                    }
                  }
                  const categoryTotal = GRADES.reduce(
                    (sum, g) => sum + gradeMonthTotals[g],
                    0
                  );

                  return (
                    <Fragment key={c.categoryId}>
                      {GRADES.map((g, gi) => {
                        const isMine = g === myGrade;
                        const monthTotal = gradeMonthTotals[g];
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
                                isMine
                                  ? "bg-green-50/60 font-bold text-green-800"
                                  : zebra
                                    ? "bg-gray-50"
                                    : "bg-white"
                              }`}
                            >
                              {g}
                            </td>
                            {dayNumbers.map((day) => {
                              const date = `${year}-${pad2(month)}-${pad2(day)}`;
                              const dow = new Date(year, month - 1, day).getDay();
                              const isWeekend = dow === 0 || dow === 6;
                              const total = presentTotals[g]?.[date] ?? 0;
                              const key = cellKey(c.categoryId, g, date);
                              const isSaving = savingKey === key;

                              if (!isMine) {
                                const saved = savedCountsRef.current[key];
                                return (
                                  <td
                                    key={day}
                                    className={`text-center border border-gray-300 py-1 text-gray-400 text-xs ${
                                      isWeekend ? "bg-orange-50/40" : ""
                                    }`}
                                  >
                                    {total > 0 ? `${saved ?? "-"}/${total}` : "-"}
                                  </td>
                                );
                              }

                              const draft = draftCounts[key] ?? "";
                              const disabled = total === 0 || isSaving;

                              return (
                                <td
                                  key={day}
                                  className={`text-center border border-gray-300 py-1 ${
                                    isWeekend ? "bg-orange-50/60" : ""
                                  }`}
                                >
                                  <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
                                    <input
                                      type="number"
                                      min={0}
                                      max={total}
                                      value={draft}
                                      disabled={disabled}
                                      placeholder={total === 0 ? "-" : "0"}
                                      onChange={(e) =>
                                        setDraftCounts((prev) => ({
                                          ...prev,
                                          [key]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") e.currentTarget.blur();
                                      }}
                                      onBlur={(e) =>
                                        commitCount(c.categoryId, date, e.target.value, total)
                                      }
                                      className="w-8 bg-transparent text-center outline-none focus:bg-white/60 rounded disabled:text-gray-300"
                                    />
                                    {total > 0 && (
                                      <span className="text-gray-400 text-[10px]">/{total}</span>
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
                              {monthTotal > 0 ? monthTotal : ""}
                            </td>
                            {gi === 0 && (
                              <td
                                rowSpan={GRADES.length}
                                className="text-center border border-gray-300 font-bold text-emerald-800 bg-emerald-50 align-middle"
                              >
                                {categoryTotal > 0 ? categoryTotal : ""}
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
          className="rounded-full bg-black text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          ＋ 追加 / Add
        </button>
      </div>
    </main>
  );
}
