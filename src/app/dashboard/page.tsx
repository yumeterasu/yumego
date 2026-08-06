"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import type { Student } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

type AttendanceRecord = { date: string; studentId: string; present: boolean };

function daysInMonth(year: number, month: number) {
  // month is 1-based
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedClass, loaded, clearSelectedClass } = useSelectedClass();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const today = todayDateString();
  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const [studentsRes, attendanceRes] = await Promise.all([
        fetch(`/api/students?class=${encodeURIComponent(selectedClass)}`),
        fetch(
          `/api/attendance?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
        ),
      ]);
      if (!studentsRes.ok || !attendanceRes.ok) throw new Error("failed");
      const studentsData = await studentsRes.json();
      const attendanceData = await attendanceRes.json();
      setStudents(studentsData.students ?? []);
      setRecords(attendanceData.records ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, yearMonth]);

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

  async function handleCellClick(studentId: string, day: number, current: boolean | undefined) {
    if (!selectedClass) return;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    if (date > today) return; // can't edit the future

    const next = current === undefined ? true : !current;
    const key = `${studentId}|${date}`;

    // optimistic update
    const previous = records;
    setRecords((prev) => {
      const others = prev.filter(
        (r) => !(r.studentId === studentId && r.date === date)
      );
      return [...others, { date, studentId, present: next }];
    });
    setSavingKey(key);
    setError(null);

    try {
      const res = await fetch("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, className: selectedClass, studentId, present: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setRecords(previous); // revert
      setError("修正の保存に失敗しました。もう一度お試しください");
    } finally {
      setSavingKey(null);
    }
  }

  function handleChangeRoom() {
    const ok = window.confirm(
      "このタブレットのクラスを変更しますか？\n（普段は押さないでください）"
    );
    if (ok) {
      clearSelectedClass();
      router.replace("/select-class");
    }
  }

  if (!loaded || !selectedClass) return null;

  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  // recordMap[studentId][day] = present boolean
  const recordMap = new Map<string, Map<number, boolean>>();
  for (const r of records) {
    const day = Number(r.date.slice(8, 10));
    if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
    recordMap.get(r.studentId)!.set(day, r.present);
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}</h1>
          <p className="text-sm text-gray-500">出席簿</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/attendance"
            className="rounded-full bg-black text-white px-5 py-2.5 font-semibold text-sm"
          >
            出席確認
          </Link>
          <button
            onClick={handleChangeRoom}
            aria-label="クラスを変更"
            className="text-gray-400 text-xs border rounded px-2 py-1"
          >
            ⚙ 設定
          </button>
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

      <p className="text-xs text-gray-400 text-center">
        過去の日付のマスをタップすると出席状況を修正できます
      </p>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中...</p>
      ) : students.length === 0 ? (
        <p className="text-gray-500 text-sm text-center">
          このクラスにはまだ生徒が登録されていません
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-2 text-left whitespace-nowrap z-10">
                  名前
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-2 py-1 text-center w-9 ${
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
                <th className="border border-gray-300 px-2 py-2 bg-green-50 text-green-800 w-10">
                  出
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-gray-100 text-gray-600 w-10">
                  欠
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const dayMap = recordMap.get(s.studentId) ?? new Map();
                let presentCount = 0;
                let absentCount = 0;
                for (const v of dayMap.values()) {
                  if (v) presentCount++;
                  else absentCount++;
                }

                return (
                  <tr key={s.studentId} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                    <td className="sticky left-0 bg-white border border-gray-300 px-3 py-2 whitespace-nowrap">
                      {s.nameKanji}
                      {s.nameEnglish && (
                        <span className="block text-[10px] text-gray-400">
                          {s.nameEnglish}
                        </span>
                      )}
                    </td>
                    {dayNumbers.map((day) => {
                      const dow = new Date(year, month - 1, day).getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const present = dayMap.get(day);
                      const date = `${year}-${pad2(month)}-${pad2(day)}`;
                      const isFuture = date > today;
                      const key = `${s.studentId}|${date}`;
                      const isSaving = savingKey === key;

                      return (
                        <td
                          key={day}
                          onClick={
                            isFuture
                              ? undefined
                              : () => handleCellClick(s.studentId, day, present)
                          }
                          className={`text-center border border-gray-300 py-2 select-none ${
                            isWeekend ? "bg-orange-50/60" : ""
                          } ${
                            isFuture
                              ? ""
                              : "cursor-pointer hover:bg-blue-50 active:bg-blue-100"
                          }`}
                        >
                          {isSaving ? (
                            <span className="text-gray-300">…</span>
                          ) : present === undefined ? (
                            ""
                          ) : present ? (
                            <span className="text-green-600 font-bold">出</span>
                          ) : (
                            <span className="text-gray-400 font-bold">欠</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center border border-gray-300 font-semibold text-green-700">
                      {presentCount}
                    </td>
                    <td className="text-center border border-gray-300 font-semibold text-gray-500">
                      {absentCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Link href="/students" className="text-xs text-gray-400 underline">
        生徒一覧の管理
      </Link>
    </main>
  );
}
