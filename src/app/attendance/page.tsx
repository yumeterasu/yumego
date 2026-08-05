"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import type { Student } from "@/lib/sheets";

function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function AttendancePage() {
  const router = useRouter();
  const { selectedClass, loaded, clearSelectedClass } = useSelectedClass();

  const [students, setStudents] = useState<Student[]>([]);
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const date = useMemo(() => todayDateString(), []);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load(selectedClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass]);

  async function load(className: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setStudents(data.students ?? []);
      setAbsentIds(new Set());
      setSubmitted(false);
    } catch {
      setError("生徒一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function toggleAbsent(studentId: string) {
    setAbsentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function handleConfirm() {
    if (!selectedClass) return;
    setSubmitting(true);
    setError(null);
    try {
      const records = students.map((s) => ({
        studentId: s.studentId,
        present: !absentIds.has(s.studentId),
      }));

      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, className: selectedClass, records }),
      });
      if (!res.ok) throw new Error("failed");
      setSubmitted(true);
    } catch {
      setError("出席の送信に失敗しました");
    } finally {
      setSubmitting(false);
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

  const presentCount = students.length - absentIds.size;

  return (
    <main className="min-h-screen p-6 max-w-lg mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}</h1>
          <p className="text-sm text-gray-500">{date}</p>
        </div>
        <button
          onClick={handleChangeRoom}
          aria-label="クラスを変更"
          className="text-gray-400 text-xs border rounded px-2 py-1"
        >
          ⚙ 設定
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : students.length === 0 ? (
        <div className="flex flex-col gap-3 items-start">
          <p className="text-gray-500 text-sm">
            このクラスにはまだ生徒が登録されていません
          </p>
          <Link
            href="/students"
            className="text-blue-600 underline text-sm"
          >
            生徒を追加する
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            欠席の生徒だけタップしてください（全員デフォルトで出席）
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {students.map((s) => {
              const isAbsent = absentIds.has(s.studentId);
              return (
                <button
                  key={s.studentId}
                  onClick={() => toggleAbsent(s.studentId)}
                  className={`rounded-xl border px-3 py-6 text-center font-medium transition ${
                    isAbsent
                      ? "bg-red-100 border-red-400 text-red-700 line-through"
                      : "bg-green-50 border-green-400 text-green-800"
                  }`}
                >
                  {s.nameKanji}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <p className="text-sm">
              出席: <span className="font-bold">{presentCount}</span> / 欠席:{" "}
              <span className="font-bold">{absentIds.size}</span>
            </p>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="rounded-full bg-black text-white px-6 py-3 font-semibold disabled:opacity-40"
            >
              {submitting ? "送信中..." : "確定する"}
            </button>
          </div>

          {submitted && (
            <p className="text-green-700 font-semibold">
              ✓ 出席を記録しました
            </p>
          )}
        </>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <Link href="/students" className="text-xs text-gray-400 underline mt-4">
        生徒一覧の管理
      </Link>
    </main>
  );
}
