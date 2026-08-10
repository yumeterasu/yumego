"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { Student } from "@/lib/sheets";

export default function StudentsPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameKanji, setNameKanji] = useState("");
  const [nameEnglish, setNameEnglish] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    loadStudents(selectedClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass]);

  async function loadStudents(className: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setStudents(data.students ?? []);
    } catch {
      setError("生徒一覧の取得に失敗しました / Failed to load students");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClass || !nameKanji.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameKanji: nameKanji.trim(),
          nameEnglish: nameEnglish.trim(),
          className: selectedClass,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setNameKanji("");
      setNameEnglish("");
      await loadStudents(selectedClass);
    } catch {
      setError("生徒の追加に失敗しました / Failed to add student");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded || !selectedClass) return null;

  return (
    <main className="min-h-screen p-6 max-w-lg mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}｜生徒管理</h1>
          <p className="text-xs text-gray-500">
            {classNameToEnglish(selectedClass)} · Student Management
          </p>
        </div>
        <Link href="/attendance" className="text-sm text-blue-600 underline text-right">
          出席へ戻る
          <span className="block text-xs">Back to attendance</span>
        </Link>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col gap-3 border rounded-xl p-4">
        <label className="flex flex-col gap-1 text-sm">
          名前（漢字）
          <span className="text-xs font-normal text-gray-500">Name (Kanji)</span>
          <input
            value={nameKanji}
            onChange={(e) => setNameKanji(e.target.value)}
            className="border rounded px-3 py-2"
            placeholder="山田 太郎"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          英語名（任意）
          <span className="text-xs font-normal text-gray-500">English name (optional)</span>
          <input
            value={nameEnglish}
            onChange={(e) => setNameEnglish(e.target.value)}
            className="border rounded px-3 py-2"
            placeholder="TARO YAMADA"
          />
        </label>
        <button
          type="submit"
          disabled={saving || !nameKanji.trim()}
          className="rounded-full bg-black text-white py-2 disabled:opacity-40"
        >
          {saving ? "追加中... / Adding..." : "生徒を追加 / Add student"}
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>

      <div>
        <h2 className="font-semibold mb-2">
          現在の生徒一覧 {!loading && `(${students.length}名)`}
          <span className="block text-xs font-normal text-gray-500">
            Current student list{!loading && ` (${students.length})`}
          </span>
        </h2>
        {loading ? (
          <p className="text-gray-500 text-sm">読み込み中... / Loading...</p>
        ) : students.length === 0 ? (
          <p className="text-gray-500 text-sm">
            まだ生徒が登録されていません / No students registered yet
          </p>
        ) : (
          <ul className="flex flex-col divide-y border rounded-xl overflow-hidden">
            {students.map((s) => (
              <li key={s.studentId} className="px-4 py-1.5 leading-tight">
                <span className="font-medium">{s.nameKanji}</span>
                {s.nameEnglish && (
                  <span className="text-xs text-gray-500 ml-2">{s.nameEnglish}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
