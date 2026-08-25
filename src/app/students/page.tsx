"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { useExtraClasses } from "@/hooks/useExtraClasses";
import { classNameToBranchGrade, classNameToEnglish } from "@/lib/classes";
import type { Student, StudentLocation } from "@/lib/sheets";

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
  const { enNames: extraClassEnNames } = useExtraClasses();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addMode, setAddMode] = useState<AddMode>("single");
  const [nameKanji, setNameKanji] = useState("");
  const [nameEnglish, setNameEnglish] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  // 送迎バス住所登録 — per-student home address, geocoded server-side.
  const [addressModal, setAddressModal] = useState<{
    studentId: string;
    nameKanji: string;
    input: string;
  } | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressFoundName, setAddressFoundName] = useState<string | null>(null);
  const [addressConfirmRemove, setAddressConfirmRemove] = useState(false);
  const [savedLocation, setSavedLocation] = useState<StudentLocation | null>(null);

  const [showInactive, setShowInactive] = useState(false);
  const [inactiveStudents, setInactiveStudents] = useState<Student[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [showRemoveAllModal, setShowRemoveAllModal] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const [removeAllError, setRemoveAllError] = useState<string | null>(null);

  // End-of-term Reset: two-step confirm, then backup-download-then-delete.
  const [showResetModal1, setShowResetModal1] = useState(false);
  const [showResetModal2, setShowResetModal2] = useState(false);
  const [resetStage, setResetStage] = useState<
    "idle" | "backing-up" | "deleting" | "done" | "error"
  >("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    studentsRemoved: number;
    scheduleRowsDeleted: number;
    headcountRowsDeleted: number;
  } | null>(null);

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

  async function handleRemoveAll() {
    if (!selectedClass) return;
    setRemovingAll(true);
    setRemoveAllError(null);
    try {
      const res = await fetch("/api/students/remove-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents([]);
      setShowRemoveAllModal(false);
    } catch {
      setRemoveAllError("削除に失敗しました / Failed to remove");
    } finally {
      setRemovingAll(false);
    }
  }

  // Step 1: fetch the backup as a blob and trigger a real local download —
  // only once that fetch genuinely succeeds (HTTP 200, non-empty body) do
  // we move on to the permanent-delete step. A plain `window.location.href`
  // navigation (used by the print/Excel buttons elsewhere) can't be
  // awaited or checked this way, which is why this flow uses fetch+blob
  // instead, even though the end result — a file landing in Downloads —
  // looks the same to the user.
  async function handleReset() {
    if (!selectedClass) return;
    setResetStage("backing-up");
    setResetError(null);
    try {
      const backupRes = await fetch(
        `/api/export/reset-backup?class=${encodeURIComponent(selectedClass)}`
      );
      if (!backupRes.ok) throw new Error("backup failed");
      const blob = await backupRes.blob();
      if (blob.size === 0) throw new Error("empty backup");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedClass.replace(/\s+/g, "_")}_reset-backup_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResetStage("deleting");
      const resetRes = await fetch("/api/students/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass }),
      });
      if (!resetRes.ok) throw new Error("reset failed");
      const data = await resetRes.json();
      setResetResult(data);
      setResetStage("done");
      setStudents([]);
    } catch {
      setResetStage("error");
      setResetError(
        "処理に失敗しました。バックアップが保存されていない場合、生徒やコーチの記録は削除されていません / Failed — if the backup wasn't saved, nothing was deleted"
      );
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

  async function openAddressModal(student: Student) {
    setAddressModal({ studentId: student.studentId, nameKanji: student.nameKanji, input: "" });
    setAddressError(null);
    setAddressFoundName(null);
    setAddressConfirmRemove(false);
    setSavedLocation(null);
    setAddressLoading(true);
    try {
      const res = await fetch(
        `/api/students/location?studentId=${encodeURIComponent(student.studentId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSavedLocation(data.location ?? null);
        if (data.location) {
          setAddressModal({
            studentId: student.studentId,
            nameKanji: student.nameKanji,
            input: data.location.address,
          });
        }
      }
    } catch {
      // no saved address yet, or fetch failed — modal still usable to enter a new one
    } finally {
      setAddressLoading(false);
    }
  }

  async function saveAddress() {
    if (!addressModal || !addressModal.input.trim()) return;
    setAddressSaving(true);
    setAddressError(null);
    setAddressFoundName(null);
    try {
      const res = await fetch("/api/students/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: addressModal.studentId, address: addressModal.input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddressError(data.error ?? "保存に失敗しました / Failed to save");
        return;
      }
      setSavedLocation(data.location);
      setAddressFoundName(data.displayName ?? null);
    } catch {
      setAddressError("保存に失敗しました / Failed to save");
    } finally {
      setAddressSaving(false);
    }
  }

  async function removeAddress() {
    if (!addressModal) return;
    setAddressSaving(true);
    setAddressError(null);
    try {
      const res = await fetch("/api/students/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: addressModal.studentId, address: null }),
      });
      if (!res.ok) throw new Error("failed");
      setSavedLocation(null);
      setAddressModal({ ...addressModal, input: "" });
      setAddressFoundName(null);
      setAddressConfirmRemove(false);
    } catch {
      setAddressError("削除に失敗しました / Failed to delete");
    } finally {
      setAddressSaving(false);
    }
  }

  if (!loaded || !selectedClass) return null;

  // Reset deletes Coach Schedule/Headcount by branch+grade, which only
  // exists for 長/中/少 classes — 小学生 has no grade row there, so hide
  // the button rather than let it fail on a class it can't ever resolve.
  const hasBranchGrade = classNameToBranchGrade(selectedClass) !== null;

  return (
    <main className="min-h-screen p-6 max-w-lg mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}｜生徒管理</h1>
          <p className="text-xs text-gray-500">
            {classNameToEnglish(selectedClass, extraClassEnNames)} · Student Management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
            <span className="block text-[10px] font-normal opacity-70">
              Back to attendance
            </span>
          </Link>
          <Link
            href="/select-class"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      <div className="border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddMode("single")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold ${
              addMode === "single"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            1人ずつ追加 / One at a time
          </button>
          <button
            type="button"
            onClick={() => setAddMode("bulk")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold ${
              addMode === "bulk"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-500"
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
              className="rounded-full bg-green-600 text-white py-2 disabled:opacity-40"
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
              className="rounded-full bg-green-600 text-white py-2 disabled:opacity-40"
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
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="font-semibold">
            現在の生徒一覧 {!loading && `(${students.length}名)`}
            <span className="block text-xs font-normal text-gray-500">
              Current student list{!loading && ` (${students.length})`}
            </span>
          </h2>
          {students.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setRemoveAllError(null);
                setShowRemoveAllModal(true);
              }}
              className="shrink-0 rounded-full border border-red-300 text-red-600 px-3 py-1 text-xs font-semibold"
            >
              全員削除 / Remove all
            </button>
          )}
        </div>
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
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => openAddressModal(s)}
                    className="text-xs text-gray-400 hover:text-blue-500 underline"
                  >
                    🏠 住所 / Address
                  </button>
                  <button
                    onClick={() => handleWithdraw(s)}
                    disabled={withdrawingId === s.studentId}
                    className="text-xs text-gray-400 hover:text-red-500 underline disabled:opacity-40"
                  >
                    削除する / Remove
                  </button>
                </div>
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

      {hasBranchGrade && (
        <div className="border-2 border-red-300 rounded-xl p-4 flex flex-col gap-2 bg-red-50/40">
          <h2 className="font-semibold text-red-700">
            学期末リセット
            <span className="block text-xs font-normal text-red-500">End-of-term reset</span>
          </h2>
          <p className="text-xs text-gray-500">
            バックアップを保存してから、このクラスの生徒と専門コーチの記録をまとめてリセットします
            <span className="block">
              Backs up this class, then clears its roster and Coach Schedule/Headcount records
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              setResetStage("idle");
              setResetError(null);
              setResetResult(null);
              setShowResetModal1(true);
            }}
            className="self-start rounded-full bg-red-600 text-white px-4 py-2 text-sm font-semibold"
          >
            🔄 リセット / Reset
          </button>
        </div>
      )}

      {showRemoveAllModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !removingAll && setShowRemoveAllModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-red-600">
              全員削除の確認
              <span className="block text-sm font-normal text-gray-500">
                Confirm remove all
              </span>
            </h2>

            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">対象クラス / Class</span>
                <span className="font-semibold">{selectedClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">対象人数 / Students</span>
                <span className="font-semibold">{students.length}名 / {students.length}</span>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              このクラスの生徒{students.length}名を全員一覧から削除します。過去の出席記録は残ります。よろしいですか？
              <span className="block">
                Removes all {students.length} students in this class from the roster. Past
                attendance stays intact. Continue?
              </span>
            </p>

            {removeAllError && (
              <p className="text-red-600 text-sm text-center">{removeAllError}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowRemoveAllModal(false)}
                disabled={removingAll}
                className="rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={handleRemoveAll}
                disabled={removingAll}
                className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
              >
                {removingAll ? "削除中... / Removing..." : "全員削除する / Remove all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset step 1/2 — explains exactly what will happen before asking for final confirmation. */}
      {showResetModal1 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => setShowResetModal1(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-red-600">
              学期末リセットの確認（1/2）
              <span className="block text-sm font-normal text-gray-500">
                Confirm reset (1/2)
              </span>
            </h2>

            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">対象クラス / Class</span>
                <span className="font-semibold">{selectedClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">対象人数 / Students</span>
                <span className="font-semibold">
                  {students.length}名 / {students.length}
                </span>
              </div>
            </div>

            <ul className="text-xs text-gray-600 list-disc pl-4 flex flex-col gap-2">
              <li>
                まずこのクラスの記録をバックアップとしてダウンロードします（生徒名簿・出席記録・コーチスケジュール・コーチ人数）
                <span className="block text-gray-400">
                  First, downloads a backup (roster, attendance, Coach Schedule, Coach Headcount)
                </span>
              </li>
              <li>
                生徒{students.length}名を一覧から削除します（後で「削除した生徒を表示」から復帰できます）
                <span className="block text-gray-400">
                  Removes all {students.length} students (recoverable later via &quot;show
                  removed students&quot;)
                </span>
              </li>
              <li className="text-red-600 font-semibold">
                このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、復元できません
                <span className="block text-red-400 font-normal">
                  This class&apos;s Coach Schedule/Headcount records are permanently deleted —
                  cannot be undone
                </span>
              </li>
              <li>
                専門コーチの種目リスト自体は削除しません（他の学年でも使うため）
                <span className="block text-gray-400">
                  The Coach category list itself is kept (other grades still use it)
                </span>
              </li>
            </ul>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowResetModal1(false)}
                className="rounded-full border border-gray-300 py-3 font-semibold"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={() => {
                  setShowResetModal1(false);
                  setShowResetModal2(true);
                }}
                className="rounded-full bg-red-600 text-white py-3 font-semibold"
              >
                次へ / Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset step 2/2 — final confirmation, then shows live progress and the result. */}
      {showResetModal2 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => resetStage === "idle" && setShowResetModal2(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {resetStage === "done" ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  完了しました
                  <span className="block text-sm font-normal text-gray-500">Done</span>
                </h2>
                <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">削除した生徒 / Students removed</span>
                    <span className="font-semibold">{resetResult?.studentsRemoved}名</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除したスケジュール記録 / Schedule rows deleted
                    </span>
                    <span className="font-semibold">{resetResult?.scheduleRowsDeleted}件</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除した人数記録 / Headcount rows deleted
                    </span>
                    <span className="font-semibold">{resetResult?.headcountRowsDeleted}件</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  バックアップファイルはダウンロードフォルダに保存されました
                  <span className="block">
                    The backup file was saved to your downloads folder
                  </span>
                </p>
                <button
                  onClick={() => setShowResetModal2(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  学期末リセットの確認（2/2）
                  <span className="block text-sm font-normal text-gray-500">
                    Confirm reset (2/2)
                  </span>
                </h2>

                <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                  <p className="text-sm text-red-800 font-semibold text-center">
                    ⚠ まずバックアップを保存します。保存が終わり次第、このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、二度と元に戻せません
                    <span className="block text-xs font-normal mt-1">
                      We&apos;ll back up the data first. Once that&apos;s done, this class&apos;s
                      Coach Schedule/Headcount records are permanently deleted — there is no undo.
                    </span>
                  </p>
                </div>

                {resetStage === "backing-up" && (
                  <p className="text-sm text-center text-gray-600">
                    📥 バックアップを保存中... / Saving backup...
                  </p>
                )}
                {resetStage === "deleting" && (
                  <p className="text-sm text-center text-gray-600">
                    🗑 削除中... / Deleting...
                  </p>
                )}
                {resetStage === "error" && resetError && (
                  <p className="text-red-600 text-sm text-center">{resetError}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowResetModal2(false)}
                    disabled={resetStage === "backing-up" || resetStage === "deleting"}
                    className="rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
                  >
                    キャンセル / Cancel
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetStage === "backing-up" || resetStage === "deleting"}
                    className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    {resetStage === "backing-up" || resetStage === "deleting"
                      ? "処理中... / Processing..."
                      : "リセットする / Reset"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {addressModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !addressSaving && setAddressModal(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {addressModal.nameKanji}
              <span className="block text-sm font-normal text-gray-500">
                送迎バス用の住所 / Home address for bus routing
              </span>
            </h2>

            {addressLoading ? (
              <p className="text-gray-400 text-sm text-center">読み込み中... / Loading...</p>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  住所
                  <span className="text-xs font-normal text-gray-500">
                    Address — type it and press 検索して保存 to look it up
                  </span>
                  <textarea
                    value={addressModal.input}
                    onChange={(e) => {
                      setAddressModal({ ...addressModal, input: e.target.value });
                      setAddressFoundName(null);
                    }}
                    placeholder="例：123 ถนนสุขุมวิท กรุงเทพฯ"
                    rows={2}
                    autoFocus
                    className="border border-gray-300 rounded-lg px-3 py-2 resize-none"
                  />
                </label>

                {addressFoundName && (
                  <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-xs text-green-800">
                    見つかりました / Found:
                    <span className="block font-medium mt-0.5">{addressFoundName}</span>
                  </div>
                )}
                {addressError && (
                  <p className="text-red-600 text-sm text-center">{addressError}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAddressModal(null)}
                    disabled={addressSaving}
                    className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
                  >
                    閉じる / Close
                  </button>
                  <button
                    onClick={saveAddress}
                    disabled={addressSaving || !addressModal.input.trim()}
                    className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
                  >
                    {addressSaving ? "検索中... / Searching..." : "検索して保存 / Look up & save"}
                  </button>
                </div>

                {savedLocation &&
                  (addressConfirmRemove ? (
                    <div className="flex flex-col gap-2 items-center">
                      <p className="text-xs text-red-600 font-semibold">
                        登録済みの住所を削除しますか？ / Remove the saved address?
                      </p>
                      <div className="grid grid-cols-2 gap-2 w-full">
                        <button
                          onClick={() => setAddressConfirmRemove(false)}
                          disabled={addressSaving}
                          className="rounded-full bg-gray-100 text-gray-600 py-2 text-sm font-semibold disabled:opacity-40"
                        >
                          キャンセル / Cancel
                        </button>
                        <button
                          onClick={removeAddress}
                          disabled={addressSaving}
                          className="rounded-full bg-red-600 text-white py-2 text-sm font-semibold disabled:opacity-40"
                        >
                          削除する / Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddressConfirmRemove(true)}
                      className="text-xs text-red-500 underline text-center"
                    >
                      登録済みの住所を削除 / Remove saved address
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
