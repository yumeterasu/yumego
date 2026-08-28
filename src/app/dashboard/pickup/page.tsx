"use client";

import { useCallback, useEffect, useRef, useState, Suspense, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Student, PickupRecord } from "@/lib/sheets";
import { branchToEnglish, type Branch } from "@/lib/classes";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// Display order for grouping the roster — 小学生 last, matching how it
// was added onto the end of each branch's class list.
const CLASS_ORDER = ["年長", "年中", "年少", "小学生"];

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

// Dark gray for both weekend days -- deliberately NOT the 出席確認/Dashboard
// red-Sunday/blue-Saturday convention, so this page reads as visually
// distinct from that one at a glance.
function weekendHeaderClasses(dow: number): string {
  if (dow === 0 || dow === 6) return "bg-gray-600 text-gray-50";
  return "bg-gray-50";
}
// Weekend color takes priority over the 降園 row's own light-orange tint
// where the two would otherwise overlap.
function cellBgClass(dow: number, field: "arrival" | "departure"): string {
  if (dow === 0 || dow === 6) return "bg-gray-300";
  return field === "departure" ? "bg-orange-50" : "";
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

  // 登園確認 — mirrors /attendance's own card-grid check-in screen (see
  // handleCardTap/submitCheckin below), just 2 states instead of 4. Only
  // ever targets today; opening it always starts everyone present,
  // independent of whatever's already on the grid for today.
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinAbsent, setCheckinAbsent] = useState<Set<string>>(new Set());
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [showCheckinConfirm, setShowCheckinConfirm] = useState(false);

  const yearMonth = `${year}-${pad2(month)}`;
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const isViewingCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

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

  // A checked cell just stores "TRUE" (matching the boolean-string
  // convention used throughout the rest of this app, e.g. Students'
  // active/check1-3 columns) rather than a specific time -- any non-empty
  // value counts as checked, so older rows that still hold a real "HH:MM"
  // from before this change display as checked too, untouched unless the
  // operator taps that specific cell again.
  async function toggleCheck(studentId: string, date: string, field: "arrival" | "departure") {
    const key = cellKey(studentId, date);
    const draftKey = `${key}|${field}`;
    const wasChecked = (drafts[draftKey] ?? "") !== "";
    const nextValue = wasChecked ? "" : "TRUE";

    setSavingKey(draftKey);
    setError(null);
    setDrafts((prev) => ({ ...prev, [draftKey]: nextValue }));
    try {
      const res = await fetch("/api/pickup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          studentId,
          [field === "arrival" ? "arrivalTime" : "departureTime"]: nextValue,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const saved = savedRef.current.get(key);
      const nextSaved: PickupRecord = {
        date,
        studentId,
        arrivalTime: field === "arrival" ? nextValue : (saved?.arrivalTime ?? ""),
        departureTime: field === "departure" ? nextValue : (saved?.departureTime ?? ""),
      };
      savedRef.current.set(key, nextSaved);
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDrafts((prev) => ({ ...prev, [draftKey]: wasChecked ? "TRUE" : "" })); // revert
    } finally {
      setSavingKey(null);
    }
  }

  // 本日は全員登園 — default everyone present for today; tap individual
  // absentees off afterward via the normal per-cell toggle above, same as
  // any other day. One batched write for the whole branch roster instead
  // of tapping in each present student one at a time.
  function openCheckin() {
    setCheckinAbsent(new Set()); // always starts everyone present
    setShowCheckin(true);
  }

  function toggleCheckinCard(studentId: string) {
    setCheckinAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function submitCheckin() {
    setCheckinSubmitting(true);
    setError(null);
    try {
      const entries = students.map((s) => ({
        studentId: s.studentId,
        present: !checkinAbsent.has(s.studentId),
      }));
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayStr, entries }),
      });
      if (!res.ok) throw new Error("failed");
      setDrafts((prev) => {
        const next = { ...prev };
        for (const { studentId, present } of entries) {
          next[`${cellKey(studentId, todayStr)}|arrival`] = present ? "TRUE" : "";
        }
        return next;
      });
      for (const { studentId, present } of entries) {
        const key = cellKey(studentId, todayStr);
        const saved = savedRef.current.get(key);
        savedRef.current.set(key, {
          date: todayStr,
          studentId,
          arrivalTime: present ? "TRUE" : "",
          departureTime: saved?.departureTime ?? "",
        });
      }
      setShowCheckinConfirm(false);
      setShowCheckin(false);
    } catch {
      setError("登園確認の保存に失敗しました / Failed to save arrival check-in");
    } finally {
      setCheckinSubmitting(false);
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
        <div className="flex items-center gap-2 print:hidden">
          <Link
            href="/select-class"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
          <div className="w-px h-6 bg-gray-300 mx-1" aria-hidden="true" />
          <button
            onClick={() => window.print()}
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="印刷 / Print"
          >
            🖨️
          </button>
          <button
            onClick={() =>
              (window.location.href = `/api/export/pickup?branch=${encodeURIComponent(
                branch
              )}&month=${yearMonth}`)
            }
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="Excelエクスポート / Excel Export"
          >
            📊
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 print:hidden">
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
      <p className="text-lg font-bold text-center hidden print:block">
        {year}年{month}月
      </p>

      {isViewingCurrentMonth && students.length > 0 && !showCheckin && (
        <div className="flex justify-center print:hidden">
          <button
            type="button"
            onClick={openCheckin}
            className="rounded-full bg-green-600 text-white px-5 py-2.5 text-sm font-semibold"
          >
            ✅ 登園確認
            <span className="block text-[10px] font-normal opacity-80">Arrival check-in</span>
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm text-center print:hidden">{error}</p>}

      {!showCheckin && loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : !showCheckin && students.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          このブランチにはまだ生徒が登録されていません
          <span className="block text-xs">No students registered in this branch yet</span>
        </p>
      ) : showCheckin ? (
        <>
          <p className="text-sm text-gray-600 print:hidden">
            全員デフォルトで登園済みです。お休みの生徒だけタップしてください
            <span className="block text-xs text-gray-400">
              Everyone starts marked arrived — tap only the students who are absent today
            </span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 print:hidden">
            {students.map((s, i) => {
              const isAbsent = checkinAbsent.has(s.studentId);
              return (
                <button
                  key={s.studentId}
                  onClick={() => toggleCheckinCard(s.studentId)}
                  className={`relative rounded-xl border-2 px-3 py-6 text-center font-medium transition ${
                    isAbsent
                      ? "bg-red-50 border-red-500 text-red-800"
                      : "bg-green-50 border-green-400 text-green-800"
                  }`}
                >
                  <span className="absolute top-1 left-2 text-xs font-normal text-gray-400">
                    {i + 1}
                  </span>
                  <span className="block">{s.nameKanji}</span>
                  {s.nameEnglish && (
                    <span className="block text-[10px] font-normal opacity-70">
                      {s.nameEnglish}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t pt-4 print:hidden">
            <p className="text-sm">
              登園: <span className="font-bold">{students.length - checkinAbsent.size}</span> /
              お休み: <span className="font-bold">{checkinAbsent.size}</span>
              <span className="block text-xs text-gray-400">
                Arrived: {students.length - checkinAbsent.size} / Absent: {checkinAbsent.size}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCheckin(false)}
                disabled={checkinSubmitting}
                className="rounded-full bg-gray-100 text-gray-600 px-6 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル
                <span className="block text-[10px] font-normal opacity-70">Cancel</span>
              </button>
              <button
                onClick={() => setShowCheckinConfirm(true)}
                disabled={checkinSubmitting}
                className="rounded-full bg-green-600 text-white px-6 py-3 font-semibold disabled:opacity-40"
              >
                確定する
                <span className="block text-[10px] font-normal opacity-70">Confirm</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-28">
                  氏名
                  <span className="block text-[9px] font-normal text-gray-400">Name</span>
                </th>
                <th className="sticky left-28 bg-gray-100 border border-gray-300 px-1 py-1 text-center whitespace-nowrap z-10 w-11">
                  —
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-0.5 py-1 text-center w-10 ${weekendHeaderClasses(dow)}`}
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
                              className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap align-top z-10 leading-tight"
                            >
                              {s.nameKanji}
                              {s.nameEnglish && (
                                <span className="block text-[10px] text-gray-400">
                                  {s.nameEnglish}
                                </span>
                              )}
                            </td>
                          )}
                          <td
                            className={`sticky left-28 border border-gray-300 px-1 py-1 text-center whitespace-nowrap text-xs text-gray-500 z-10 ${
                              field === "departure" ? "bg-orange-50" : "bg-white"
                            }`}
                          >
                            {field === "arrival" ? "登園" : "降園"}
                          </td>
                          {dayNumbers.map((day) => {
                            const date = `${year}-${pad2(month)}-${pad2(day)}`;
                            const dow = new Date(year, month - 1, day).getDay();
                            const isWeekend = dow === 0 || dow === 6;
                            const draftKey = `${cellKey(s.studentId, date)}|${field}`;
                            const isSaving = savingKey === draftKey;
                            const isChecked = (drafts[draftKey] ?? "") !== "";
                            return (
                              <td
                                key={day}
                                onClick={() =>
                                  !isSaving && !isWeekend && toggleCheck(s.studentId, date, field)
                                }
                                className={`text-center border border-gray-300 py-1 select-none ${
                                  isWeekend
                                    ? "cursor-default"
                                    : isSaving
                                      ? "opacity-40 cursor-wait"
                                      : "cursor-pointer"
                                } ${cellBgClass(dow, field)}`}
                              >
                                <div className="w-6 h-6 mx-auto flex items-center justify-center">
                                  {isWeekend ? null : isChecked ? (
                                    <span className="w-6 h-6 rounded-full border-[3px] border-red-600" />
                                  ) : (
                                    <span className="text-gray-300 text-base leading-none">—</span>
                                  )}
                                </div>
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

      {showCheckinConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h2 className="text-lg font-bold text-center">
              本日の登園確認
              <span className="block text-sm font-normal text-gray-500">
                Today&apos;s arrival check-in
              </span>
            </h2>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-3xl font-bold text-green-700">
                  {students.length - checkinAbsent.size}
                </p>
                <p className="text-sm text-gray-500">
                  登園
                  <span className="block text-xs">Arrived</span>
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{checkinAbsent.size}</p>
                <p className="text-sm text-gray-500">
                  お休み
                  <span className="block text-xs">Absent</span>
                </p>
              </div>
            </div>
            {checkinAbsent.size > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">お休みの生徒: / Absent students:</p>
                <ul className="flex flex-wrap gap-2">
                  {students
                    .filter((s) => checkinAbsent.has(s.studentId))
                    .map((s) => (
                      <li
                        key={s.studentId}
                        className="text-xs bg-red-50 text-red-700 rounded-full px-3 py-1"
                      >
                        {s.nameEnglish || s.nameKanji}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-gray-400 text-center">
              この内容で記録します。よろしいですか？
              <span className="block">Record with this content — is that OK?</span>
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowCheckinConfirm(false)}
                disabled={checkinSubmitting}
                className="flex-1 rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={submitCheckin}
                disabled={checkinSubmitting}
                className="flex-1 rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
              >
                {checkinSubmitting ? "送信中... / Sending..." : "送信する / Submit"}
              </button>
            </div>
          </div>
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
