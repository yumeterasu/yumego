"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { Student, AttendanceStatus } from "@/lib/sheets";

type AttendanceRecord = { date: string; studentId: string; status: AttendanceStatus };

const MONTH_EN = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
];

// 遅刻/早退 count toward 出席日数; 出席停止 does not.
function countsAsPresent(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "early_leave";
}

// Japanese school year: April through March. monthNum is the calendar
// month (1-12); yearOffset is 0 for Apr-Dec, 1 for Jan-Mar (next
// calendar year relative to the fiscal year's start year).
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

function defaultFiscalYearStart(): number {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

export default function SummaryPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const [fiscalYearStart, setFiscalYearStart] = useState(defaultFiscalYearStart);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [savingRemarkId, setSavingRemarkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const [studentsRes, summaryRes] = await Promise.all([
        fetch(`/api/students?class=${encodeURIComponent(selectedClass)}`),
        fetch(
          `/api/attendance/summary?class=${encodeURIComponent(selectedClass)}&fiscalYear=${fiscalYearStart}`
        ),
      ]);
      if (!studentsRes.ok || !summaryRes.ok) throw new Error("failed");
      const studentsData = await studentsRes.json();
      const summaryData = await summaryRes.json();
      const loadedStudents: Student[] = studentsData.students ?? [];
      setStudents(loadedStudents);
      setRecords(summaryData.records ?? []);
      setRemarks(
        Object.fromEntries(loadedStudents.map((s) => [s.studentId, s.remark ?? ""]))
      );
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, fiscalYearStart]);

  async function handleRemarkBlur(studentId: string, value: string) {
    const original = students.find((s) => s.studentId === studentId)?.remark ?? "";
    if (value === original) return; // nothing changed, skip the request

    setSavingRemarkId(studentId);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, remark: value }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents((prev) =>
        prev.map((s) => (s.studentId === studentId ? { ...s, remark: value } : s))
      );
    } catch {
      setError("備考の保存に失敗しました / Failed to save note");
      setRemarks((prev) => ({ ...prev, [studentId]: original })); // revert
    } finally {
      setSavingRemarkId(null);
    }
  }

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load();
  }, [loaded, selectedClass, router, load]);

  if (!loaded || !selectedClass) return null;

  // Collapse to one status per student+date first (mirrors the monthly
  // Dashboard's per-day Map) — otherwise a stray duplicate row for the same
  // day would be counted twice here even though the monthly view only ever
  // shows/counts it once, making the two pages disagree.
  const dedupedByStudentDate = new Map<string, AttendanceStatus>();
  for (const r of records) {
    dedupedByStudentDate.set(`${r.studentId}|${r.date}`, r.status);
  }

  // studentId -> monthIndex(0-11, Apr..Mar) -> present day count
  const counts = new Map<string, number[]>();
  for (const s of students) counts.set(s.studentId, new Array(12).fill(0));

  for (const [key, status] of dedupedByStudentDate) {
    if (!countsAsPresent(status)) continue;
    const [studentId, date] = key.split("|");
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const monthIndex = FISCAL_MONTHS.findIndex(
      (fm) => fm.monthNum === m && fiscalYearStart + fm.yearOffset === y
    );
    if (monthIndex === -1) continue;
    const arr = counts.get(studentId);
    if (arr) arr[monthIndex]++;
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}</h1>
          <p className="text-xs text-gray-400">{classNameToEnglish(selectedClass)}</p>
          <p className="text-sm text-gray-500">
            年間まとめ
            <span className="ml-1 text-xs text-gray-400">Annual Summary</span>
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
          <Link
            href="/select-class"
            className="rounded-full border border-gray-300 text-gray-700 px-4 py-2.5 text-sm font-semibold"
          >
            🏠 トップページ
            <span className="block text-[10px] font-normal opacity-70">Home</span>
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setFiscalYearStart((y) => y - 1)}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="前年度 / Previous fiscal year"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-40 text-center">
          {fiscalYearStart}年度
        </p>
        <button
          onClick={() => setFiscalYearStart((y) => y + 1)}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="翌年度 / Next fiscal year"
        >
          ▶
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        各月の出席した日数（{fiscalYearStart}年4月〜{fiscalYearStart + 1}年3月）
        <span className="block">
          Present days per month (Apr {fiscalYearStart} – Mar {fiscalYearStart + 1})
        </span>
      </p>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : students.length === 0 ? (
        <p className="text-gray-500 text-sm text-center">
          このクラスにはまだ生徒が登録されていません
          <span className="block text-xs">No students registered in this class yet</span>
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10">
                  名前
                  <span className="block text-[9px] font-normal text-gray-400">Name</span>
                </th>
                {FISCAL_MONTHS.map((fm, idx) => (
                  <th
                    key={fm.monthNum}
                    className="border border-gray-300 px-2 py-2 text-center bg-gray-50 w-12 whitespace-nowrap"
                  >
                    {fm.monthNum}月
                    <span className="block text-[9px] font-normal text-gray-400">
                      {MONTH_EN[idx]}
                    </span>
                  </th>
                ))}
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-20 whitespace-nowrap">
                  出席日数
                  <span className="block text-[9px] font-normal">Present Days</span>
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-gray-50 text-gray-700 w-40 whitespace-nowrap">
                  備考
                  <span className="block text-[9px] font-normal text-gray-400">Notes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const monthCounts = counts.get(s.studentId) ?? new Array(12).fill(0);
                const total = monthCounts.reduce((a, b) => a + b, 0);

                return (
                  <tr key={s.studentId} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                    <td className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap leading-tight">
                      {s.nameKanji}
                      {s.nameEnglish && (
                        <span className="block text-[10px] text-gray-400">
                          {s.nameEnglish}
                        </span>
                      )}
                    </td>
                    {monthCounts.map((count, idx) => (
                      <td key={idx} className="text-center border border-gray-300 py-1">
                        {count > 0 ? count : ""}
                      </td>
                    ))}
                    <td className="text-center border border-gray-300 font-semibold text-green-700">
                      {total}
                    </td>
                    <td className="border border-gray-300 p-0">
                      <input
                        value={remarks[s.studentId] ?? ""}
                        onChange={(e) =>
                          setRemarks((prev) => ({
                            ...prev,
                            [s.studentId]: e.target.value,
                          }))
                        }
                        onBlur={(e) => handleRemarkBlur(s.studentId, e.target.value)}
                        disabled={savingRemarkId === s.studentId}
                        placeholder={savingRemarkId === s.studentId ? "保存中... / Saving..." : ""}
                        className="w-full h-full px-2 py-1 text-sm outline-none focus:bg-blue-50 disabled:bg-gray-50"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
