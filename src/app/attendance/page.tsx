"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import type { Student } from "@/lib/sheets";
import { enqueue, flushQueue, getQueue } from "@/lib/offlineQueue";

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
  // Who is marked present. Empty by default — nobody has arrived yet.
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const date = useMemo(() => todayDateString(), []);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(getQueue().length);
  }, []);

  const syncPending = useCallback(async () => {
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      refreshPendingCount();
      setSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load(selectedClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass]);

  // Try to flush any queued submissions on load and whenever the device
  // comes back online.
  useEffect(() => {
    refreshPendingCount();
    syncPending();
    window.addEventListener("online", syncPending);
    return () => window.removeEventListener("online", syncPending);
  }, [refreshPendingCount, syncPending]);

  async function load(className: string) {
    setLoading(true);
    setError(null);
    const cacheKey = `yumego.studentsCache.${className}`;
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setStudents(data.students ?? []);
      localStorage.setItem(cacheKey, JSON.stringify(data.students ?? []));
      setPresentIds(new Set());
      setSubmitted(false);
      setQueuedOffline(false);
    } catch {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setStudents(JSON.parse(cached));
        setError("オフラインです。前回保存した生徒一覧を表示しています");
      } else {
        setError("生徒一覧の取得に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  }

  function togglePresent(studentId: string) {
    setPresentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function markAllPresent() {
    setPresentIds(new Set(students.map((s) => s.studentId)));
  }

  async function handleSubmit() {
    if (!selectedClass) return;
    setSubmitting(true);
    setError(null);

    const records = students.map((s) => ({
      studentId: s.studentId,
      present: presentIds.has(s.studentId),
    }));
    const payload = { date, className: selectedClass, records };

    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("failed");
      setSubmitted(true);
      setQueuedOffline(false);
      setShowConfirmModal(false);
    } catch {
      // Network failure (offline) or the request never reached the server —
      // save it locally and retry automatically once the connection returns.
      enqueue(payload);
      refreshPendingCount();
      setSubmitted(true);
      setQueuedOffline(true);
      setShowConfirmModal(false);
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

  const presentCount = presentIds.size;
  const absentStudents = students.filter((s) => !presentIds.has(s.studentId));
  const absentCount = absentStudents.length;

  return (
    <main className="min-h-screen p-6 max-w-lg md:max-w-4xl lg:max-w-6xl mx-auto flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="self-start text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
      >
        ← 出席簿に戻る
      </Link>

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

      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3">
          <p className="text-sm text-yellow-800">
            ⚠ オフライン保存中の出席が <b>{pendingCount}件</b> あります
          </p>
          <button
            onClick={syncPending}
            disabled={syncing}
            className="shrink-0 text-sm font-semibold text-yellow-900 border border-yellow-400 rounded-full px-3 py-1 disabled:opacity-40"
          >
            {syncing ? "送信中..." : "今すぐ送信"}
          </button>
        </div>
      )}

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
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              来た生徒をタップしてください（全員デフォルトで未出席）
            </p>
            <button
              onClick={markAllPresent}
              className="shrink-0 rounded-full border border-green-500 text-green-700 text-sm font-semibold px-4 py-2 hover:bg-green-50"
            >
              全員出席
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {students.map((s, i) => {
              const isPresent = presentIds.has(s.studentId);
              return (
                <button
                  key={s.studentId}
                  onClick={() => togglePresent(s.studentId)}
                  className={`relative rounded-xl border-2 px-3 py-6 text-center font-medium transition ${
                    isPresent
                      ? "bg-green-50 border-green-500 text-green-800 ring-2 ring-green-300"
                      : "bg-gray-50 border-gray-300 text-gray-500"
                  }`}
                >
                  <span className="absolute top-1 left-2 text-xs font-normal text-gray-400">
                    {i + 1}
                  </span>
                  {s.nameEnglish || s.nameKanji}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <p className="text-sm">
              出席: <span className="font-bold">{presentCount}</span> / 未出席:{" "}
              <span className="font-bold">{absentCount}</span>
            </p>
            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={submitting}
              className="rounded-full bg-black text-white px-6 py-3 font-semibold disabled:opacity-40"
            >
              確定する
            </button>
          </div>

          {submitted && !queuedOffline && (
            <p className="text-green-700 font-semibold">
              ✓ 出席を記録しました
            </p>
          )}
          {submitted && queuedOffline && (
            <p className="text-yellow-800 font-semibold">
              📶 オフラインのため端末に保存しました。オンラインになったら自動で送信します
            </p>
          )}
        </>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <Link href="/students" className="text-xs text-gray-400 underline mt-4">
        生徒一覧の管理
      </Link>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h2 className="text-lg font-bold text-center">
              本日の出席状況
            </h2>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-3xl font-bold text-green-700">
                  {presentCount}
                </p>
                <p className="text-sm text-gray-500">出席</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-500">
                  {absentCount}
                </p>
                <p className="text-sm text-gray-500">未出席</p>
              </div>
            </div>
            {absentStudents.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">未出席の生徒:</p>
                <ul className="flex flex-wrap gap-2">
                  {absentStudents.map((s) => (
                    <li
                      key={s.studentId}
                      className="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1"
                    >
                      {s.nameEnglish || s.nameKanji}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-400 text-center">
              この内容で記録します。よろしいですか？
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                className="flex-1 rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-full bg-black text-white py-3 font-semibold disabled:opacity-40"
              >
                {submitting ? "送信中..." : "送信する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
