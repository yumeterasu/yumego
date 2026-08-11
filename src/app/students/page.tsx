"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { Student } from "@/lib/sheets";

type AddMode = "single" | "bulk";

/**
 * Parses the bulk-add textarea: one student per line. Accepts either a
 * straight paste of two adjacent spreadsheet columns (kanji + English,
 * which browsers paste as tab-separated) or manually typed "漢字,English"
 * (English optional either way).
 */
function parseBulkNames(text: string): { nameKanji: string; nameEnglish: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sepIdx = line.includes("\t") ? line.indexOf("\t") : line.indexOf(",");
      if (sepIdx === -1) return { nameKanji: line, nameEnglish: "" };
      return {
        nameKanji: line.slice(0, sepIdx).trim(),
        nameEnglish: line.slice(sepIdx + 1).trim(),
      };
    })
    .filter((s) => s.nameKanji.length > 0);
}

export default function StudentsPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addMode, setAddMode] = useState<AddMode>("single");
  const [nameKanji, setNameKanji] = useState("");
  const [nameEnglish, setNameEnglish] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const [showInactive, setShowInactive] = useState(false);
  const [inactiveStudents, setInactiveStudents] = useState<Student[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

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

  async function loadInactiveStudents(className: string) {
    setLoadingInactive(true);
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}&includeInactive=true`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const all: Student[] = data.students ?? [];
      setInactiveStudents(all.filter((s) => !s.active));
    } catch {
      setError("非表示の生徒一覧の取得に失敗しました / Failed to load withdrawn students");
    } finally {
      setLoadingInactive(false);
    }
  }

  function toggleShowInactive() {
    const next = !showInactive;
    setShowInactive(next);
    if (next && selectedClass) loadInactiveStudents(selectedClass);
  }

  async function handleAddSingle(e: React.FormEvent) {
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

  const bulkParsed = parseBulkNames(bulkText);

  async function handleAddBulk() {
    if (!selectedClass || bulkParsed.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/students/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass, students: bulkParsed }),
      });
      if (!res.ok) throw new Error("failed");
      setBulkText("");
      await loadStudents(selectedClass);
    } catch {
      setError("一括追加に失敗しました / Failed to bulk-add students");
    } finally {
      setSaving(false);
    }
  }

  async function handleWithdraw(student: Student) {
    if (
      !window.confirm(
        `${student.nameKanji} を削除しますか？（卒園・退会・登録ミスなど理由は問いません）\n\n一覧から見えなくなりますが、過去の出席記録は残ります。\n\nRemove ${student.nameKanji}? (For any reason — graduated, withdrew, entered by mistake, etc.) They'll disappear from the roster, but past attendance stays intact.`
      )
    ) {
      return;
    }
    setWithdrawingId(student.studentId);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, active: false }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents((prev) => prev.filter((s) => s.studentId !== student.studentId));
    } catch {
      setError("更新に失敗しました / Failed to update");
    } finally {
      setWithdrawingId(null);
    }
  }

  async function handleRestore(student: Student) {
    setRestoringId(student.studentId);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, active: true }),
      });
      if (!res.ok) throw new Error("failed");
      setInactiveStudents((prev) => prev.filter((s) => s.studentId !== student.studentId));
      if (selectedClass) await loadStudents(selectedClass);
    } catch {
      setError("復帰に失敗しました / Failed to restore");
    } finally {
      setRestoringId(null);
    }
  }

  if (!loaded || !selectedClass) return null;

  return (
    <main className="min-h-screen p-6 max-w-lg mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}｜生徒管理</h1>
          <p className="text-xs text-gray-500">
            {classNameToEnglish(selectedClass)} · Student Management
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

      <div className="border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddMode("single")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold border ${
              addMode === "single"
                ? "bg-black text-white border-black"
                : "border-gray-300 text-gray-500"
            }`}
          >
            1人ずつ追加 / One at a time
          </button>
          <button
            type="button"
            onClick={() => setAddMode("bulk")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold border ${
              addMode === "bulk"
                ? "bg-black text-white border-black"
                : "border-gray-300 text-gray-500"
            }`}
          >
            まとめて追加 / Add many at once
          </button>
        </div>

        {addMode === "single" ? (
          <form onSubmit={handleAddSingle} className="flex flex-col gap-3">
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
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              1行に1人ずつ貼り付けてください（表計算ソフトの2列をそのまま貼り付けてもOK）
              <span className="text-xs font-normal text-gray-500">
                Paste one student per line — works with two spreadsheet columns pasted
                directly (kanji + English), or manually typed &quot;漢字,English&quot;
                (English optional either way)
              </span>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
                placeholder={"山田 太郎, TARO YAMADA\n佐藤 花子, HANAKO SATO\n鈴木 次郎"}
                className="border rounded px-3 py-2 font-mono text-sm"
              />
            </label>
            <p className="text-xs text-gray-500">
              {bulkParsed.length}人を追加します / {bulkParsed.length} student(s) will be added
            </p>
            <button
              type="button"
              onClick={handleAddBulk}
              disabled={saving || bulkParsed.length === 0}
              className="rounded-full bg-black text-white py-2 disabled:opacity-40"
            >
              {saving
                ? "追加中... / Adding..."
                : `${bulkParsed.length}人を追加 / Add ${bulkParsed.length}`}
            </button>
          </div>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>

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
              <li
                key={s.studentId}
                className="px-4 py-1.5 leading-tight flex items-center justify-between gap-2"
              >
                <div>
                  <span className="font-medium">{s.nameKanji}</span>
                  {s.nameEnglish && (
                    <span className="text-xs text-gray-500 ml-2">{s.nameEnglish}</span>
                  )}
                </div>
                <button
                  onClick={() => handleWithdraw(s)}
                  disabled={withdrawingId === s.studentId}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-500 underline disabled:opacity-40"
                >
                  削除する / Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={toggleShowInactive}
          className="text-xs text-gray-400 underline"
        >
          {showInactive ? "非表示の生徒を隠す" : "削除した生徒を表示"} / {showInactive ? "Hide" : "Show"} removed students
        </button>
        {showInactive && (
          <div className="mt-2">
            {loadingInactive ? (
              <p className="text-gray-400 text-xs">読み込み中... / Loading...</p>
            ) : inactiveStudents.length === 0 ? (
              <p className="text-gray-400 text-xs">
                削除した生徒はいません / No removed students
              </p>
            ) : (
              <ul className="flex flex-col divide-y border rounded-xl overflow-hidden">
                {inactiveStudents.map((s) => (
                  <li
                    key={s.studentId}
                    className="px-4 py-1.5 leading-tight flex items-center justify-between gap-2 bg-gray-50 text-gray-500"
                  >
                    <div>
                      <span className="font-medium">{s.nameKanji}</span>
                      {s.nameEnglish && (
                        <span className="text-xs ml-2">{s.nameEnglish}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(s)}
                      disabled={restoringId === s.studentId}
                      className="shrink-0 text-xs text-blue-500 underline disabled:opacity-40"
                    >
                      復帰させる / Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

    </main>
  );
}
