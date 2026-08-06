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

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中...</p>
      ) : students.length === 0 ? (
        <p className="text-gray-500 text-sm text-center">
          このクラスにはまだ生徒が登録されていません
        </p>
      ) : (
        <div className="overflow-x-auto border rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border-b border-r px-3 py-2 text-left whitespace-nowrap z-10">
                  名前
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <th
                      key={day}
                      className={`border-b px-2 py-1 text-center w-9 ${
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
                <th className="border-b border-l px-2 py-2 bg-green-50 text-green-800 w-10">
                  出
                </th>
                <th className="border-b px-2 py-2 bg-gray-100 text-gray-600 w-10">
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
                    <td className="sticky left-0 bg-white border-r px-3 py-2 whitespace-nowrap">
                      {s.nameKanji}
                      {s.nameFurigana && (
                        <span className="block text-[10px] text-gray-400">
                          {s.nameFurigana}
                        </span>
                      )}
                    </td>
                    {dayNumbers.map((day) => {
                      const dow = new Date(year, month - 1, day).getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const present = dayMap.get(day);
                      return (
                        <td
                          key={day}
                          className={`text-center py-2 ${
                            isWeekend ? "bg-orange-50/60" : ""
                          }`}
                        >
                          {present === undefined ? (
                            ""
                          ) : present ? (
                            <span className="text-green-600 font-bold">出</span>
                          ) : (
                            <span className="text-gray-400 font-bold">欠</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center border-l font-semibold text-green-700">
                      {presentCount}
                    </td>
                    <td className="text-center font-semibold text-gray-500">
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
