"use client";

import { useCallback, useEffect, useRef, useState, Suspense, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Student, PickupRecord } from "@/lib/sheets";
import { branchToEnglish, type Branch } from "@/lib/classes";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// Display order for grouping the roster — Summer last, matching how it
// was added onto the end of each branch's class list.
const CLASS_ORDER = ["年長", "年中", "年少", "Summer"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function cellKey(studentId: string, date: string) {
  return `${studentId}|${date}`;
}
function classOrderIndex(className: string) {
  const idx = CLASS_ORDER.findIndex((suffix) => className.endsWith(suffix));
  return idx === -1 ? CLASS_ORDER.length : idx;
}

function PickupPageInner() {
  const searchParams = useSearchParams();
  const branch = (searchParams.get("branch") ?? "") as Branch | "";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [students, setStudents] = useState<Student[]>([]);
  // "studentId|date" -> confirmed-saved record, kept separate from the
  // live draft text so comparing "did this change?" never compares a
  // value to its own already-mutated self.
  const savedRef = useRef<Map<string, PickupRecord>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pickup?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const loadedStudents: Student[] = data.students ?? [];
      loadedStudents.sort((a, b) => classOrderIndex(a.className) - classOrderIndex(b.className));
      setStudents(loadedStudents);

      const records: PickupRecord[] = data.records ?? [];
      const saved = new Map<string, PickupRecord>();
      const nextDrafts: Record<string, string> = {};
      for (const r of records) {
        const key = cellKey(r.studentId, r.date);
        saved.set(key, r);
        nextDrafts[`${key}|arrival`] = r.arrivalTime;
        nextDrafts[`${key}|departure`] = r.departureTime;
      }
      savedRef.current = saved;
      setDrafts(nextDrafts);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [branch, yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

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

  async function commitTime(studentId: string, date: string, field: "arrival" | "departure") {
    const key = cellKey(studentId, date);
    const draftKey = `${key}|${field}`;
    const value = drafts[draftKey] ?? "";
    const saved = savedRef.current.get(key);
    const original = field === "arrival" ? (saved?.arrivalTime ?? "") : (saved?.departureTime ?? "");
    if (value === original) return; // nothing changed, skip the request

    setSavingKey(draftKey);
    setError(null);
    try {
      const res = await fetch("/api/pickup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          studentId,
          [field === "arrival" ? "arrivalTime" : "departureTime"]: value,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const nextSaved: PickupRecord = {
        date,
        studentId,
        arrivalTime: field === "arrival" ? value : (saved?.arrivalTime ?? ""),
        departureTime: field === "departure" ? value : (saved?.departureTime ?? ""),
      };
      savedRef.current.set(key, nextSaved);
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDrafts((prev) => ({ ...prev, [draftKey]: original }));
    } finally {
      setSavingKey(null);
    }
  }

  if (!branch) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500 text-sm text-center">
          不正なリンクです。トップページからやり直してください
          <span className="block text-xs">
            Invalid link — please go back to the top page and try again
          </span>
        </p>
      </main>
    );
  }

  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{branch} 送迎管理</h1>
          <p className="text-xs text-gray-400">
            {branchToEnglish(branch)} · Pickup/Drop-off Management
          </p>
          <p className="text-sm text-gray-500">
            この支店の全クラスの登園・降園時間をまとめて記録します
            <span className="block text-xs">
              Records arrival/departure times for every class in this branch
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
      ) : students.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          このブランチにはまだ生徒が登録されていません
          <span className="block text-xs">No students registered in this branch yet</span>
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-28">
                  氏名
                  <span className="block text-[9px] font-normal text-gray-400">Name</span>
                </th>
                <th className="sticky left-28 bg-gray-100 border border-gray-300 px-2 py-1 text-center whitespace-nowrap z-10 w-16">
                  —
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-1 py-1 text-center w-24 ${
                        isWeekend ? "bg-orange-50 text-orange-700" : "bg-gray-50"
                      }`}
                    >
                      <div>{day}</div>
                      <div className="text-[10px] font-normal">{WEEKDAY_LABELS[dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(() => {
                let lastClassName: string | null = null;
                return students.map((s) => {
                  const showGroupHeader = s.className !== lastClassName;
                  lastClassName = s.className;
                  const label = s.nameEnglish || s.nameKanji;

                  return (
                    <Fragment key={s.studentId}>
                      {showGroupHeader && (
                        <tr>
                          <td
                            colSpan={dayNumbers.length + 2}
                            className="sticky left-0 bg-blue-50 border border-gray-300 px-3 py-1 font-semibold text-blue-800 text-xs"
                          >
                            {s.className}
                          </td>
                        </tr>
                      )}
                      {(["arrival", "departure"] as const).map((field, fi) => (
                        <tr key={field}>
                          {fi === 0 && (
                            <td
                              rowSpan={2}
                              className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap align-top z-10"
                            >
                              {label}
                            </td>
                          )}
                          <td className="sticky left-28 bg-white border border-gray-300 px-2 py-1 text-center whitespace-nowrap text-xs text-gray-500 z-10">
                            {field === "arrival" ? "登園" : "降園"}
                          </td>
                          {dayNumbers.map((day) => {
                            const date = `${year}-${pad2(month)}-${pad2(day)}`;
                            const dow = new Date(year, month - 1, day).getDay();
                            const isWeekend = dow === 0 || dow === 6;
                            const draftKey = `${cellKey(s.studentId, date)}|${field}`;
                            const isSaving = savingKey === draftKey;
                            return (
                              <td
                                key={day}
                                className={`text-center border border-gray-300 py-0.5 ${
                                  isWeekend ? "bg-orange-50/60" : ""
                                }`}
                              >
                                <input
                                  type="time"
                                  value={drafts[draftKey] ?? ""}
                                  disabled={isSaving}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))
                                  }
                                  onBlur={() => commitTime(s.studentId, date, field)}
                                  className="w-full text-center text-xs outline-none bg-transparent focus:bg-blue-50 disabled:opacity-40"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function PickupPage() {
  return (
    <Suspense fallback={null}>
      <PickupPageInner />
    </Suspense>
  );
}
