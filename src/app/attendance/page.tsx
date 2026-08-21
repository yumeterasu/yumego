"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { Student, AttendanceStatus } from "@/lib/sheets";
import { enqueue, flushQueue, getQueue } from "@/lib/offlineQueue";
import { REASON_OPTIONS, type AbsenceBucket } from "@/lib/absenceReasons";

function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}年${m}月${d}日(${WEEKDAY_LABELS[dow]})`;
}

type Absence = { status: AbsenceBucket | "late" | "early_leave"; reason: string };

export default function AttendancePage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const [students, setStudents] = useState<Student[]>([]);
  // Everyone starts present. Only students tapped-out show up here.
  const [absences, setAbsences] = useState<Map<string, Absence>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Which student's reason picker is open, and its "その他" sub-state.
  const [reasonPickerFor, setReasonPickerFor] = useState<{
    studentId: string;
    label: string;
  } | null>(null);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [otherStatus, setOtherStatus] = useState<AbsenceBucket>("absent");

  const today = useMemo(() => todayDateString(), []);
  // Defaults to today, but can be navigated back to backfill a day that
  // was missed entirely (see the ◀/▶ nav below). Never allowed past today.
  const [date, setDate] = useState(today);
  const isToday = date === today;

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
    load(selectedClass, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass, date]);

  // Try to flush any queued submissions on load and whenever the device
  // comes back online.
  useEffect(() => {
    refreshPendingCount();
    syncPending();
    window.addEventListener("online", syncPending);
    return () => window.removeEventListener("online", syncPending);
  }, [refreshPendingCount, syncPending]);

  async function load(className: string, forDate: string) {
    setLoading(true);
    setError(null);
    const cacheKey = `yumego.studentsCache.${className}`;
    try {
      const yearMonth = forDate.slice(0, 7);
      const [studentsRes, attendanceRes] = await Promise.all([
        fetch(`/api/students?class=${encodeURIComponent(className)}`),
        fetch(
          `/api/attendance?class=${encodeURIComponent(className)}&month=${yearMonth}`
        ),
      ]);
      if (!studentsRes.ok) throw new Error("failed");
      const data = await studentsRes.json();
      const loadedStudents: Student[] = data.students ?? [];
      setStudents(loadedStudents);
      localStorage.setItem(cacheKey, JSON.stringify(loadedStudents));

      // Prefill from whatever's already recorded for this exact date —
      // e.g. a half-finished backfill — instead of wiping it back to
      // "everyone present" every time the date changes.
      const existing = new Map<string, Absence>();
      if (attendanceRes.ok) {
        const attendanceData = await attendanceRes.json();
        const records: { date: string; studentId: string; status: AttendanceStatus; reason: string }[] =
          attendanceData.records ?? [];
        for (const r of records) {
          if (r.date !== forDate || r.status === "present") continue;
          existing.set(r.studentId, {
            status: r.status as Absence["status"],
            reason: r.reason ?? "",
          });
        }
      }
      setAbsences(existing);
      setSubmitted(false);
      setQueuedOffline(false);
    } catch {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setStudents(JSON.parse(cached));
        setAbsences(new Map());
        setError(
          "オフラインです。前回保存した生徒一覧を表示しています / Offline — showing the last saved student list"
        );
      } else {
        setError("生徒一覧の取得に失敗しました / Failed to load students");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleStudentClick(studentId: string, label: string) {
    if (absences.has(studentId)) {
      // Already marked absent/late — tapping again undoes it back to
      // present immediately (no popup), since sometimes you know right away
      // you tapped the wrong thing.
      setAbsences((prev) => {
        const next = new Map(prev);
        next.delete(studentId);
        return next;
      });
      return;
    }
    setShowOtherInput(false);
    setOtherText("");
    setOtherStatus("absent");
    setReasonPickerFor({ studentId, label });
  }

  function pickReason(label: string, status: AbsenceBucket) {
    if (!reasonPickerFor) return;
    setAbsences((prev) => {
      const next = new Map(prev);
      next.set(reasonPickerFor.studentId, { status, reason: label });
      return next;
    });
    setReasonPickerFor(null);
  }

  // Late is still "present", just delayed, so no absence reason applies.
  // Knowable right at check-in time, unlike early-leave which only
  // happens later in the day and stays a Dashboard-only edit. Tapping an
  // already-late student later reverts straight back to present via the
  // same generic handleStudentClick check below (no separate undo needed).
  function pickLate() {
    if (!reasonPickerFor) return;
    setAbsences((prev) => {
      const next = new Map(prev);
      next.set(reasonPickerFor.studentId, { status: "late", reason: "" });
      return next;
    });
    setReasonPickerFor(null);
  }

  // 早退 (early leave) — also still "present" for the day, just leaving
  // early. Often known in advance too (a parent calls ahead), so it
  // belongs in this same picker alongside 遅刻.
  function pickEarlyLeave() {
    if (!reasonPickerFor) return;
    setAbsences((prev) => {
      const next = new Map(prev);
      next.set(reasonPickerFor.studentId, { status: "early_leave", reason: "" });
      return next;
    });
    setReasonPickerFor(null);
  }

  function applyOtherReason() {
    if (!reasonPickerFor || !otherText.trim()) return;
    setAbsences((prev) => {
      const next = new Map(prev);
      next.set(reasonPickerFor.studentId, {
        status: otherStatus,
        reason: otherText.trim(),
      });
      return next;
    });
    setReasonPickerFor(null);
  }

  async function handleSubmit() {
    if (!selectedClass) return;
    setSubmitting(true);
    setError(null);

    const records = students.map((s) => {
      const absence = absences.get(s.studentId);
      const status: AttendanceStatus = absence ? absence.status : "present";
      return { studentId: s.studentId, status, reason: absence?.reason ?? "" };
    });
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
      // For today, jump straight to the dashboard as before. For a
      // backfilled past date, stay put so ◀ can keep walking back through
      // other missed days without re-navigating here each time.
      if (date === today) router.push("/dashboard");
    } catch {
      // Network failure (offline) or the request never reached the server —
      // save it locally and retry automatically once the connection returns.
      enqueue(payload);
      refreshPendingCount();
      setSubmitted(true);
      setQueuedOffline(true);
      setShowConfirmModal(false);
      if (date === today) router.push("/dashboard");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded || !selectedClass) return null;

  // Late and early-leave count toward present, not absent — same rule
  // as everywhere else in the app.
  const lateStudents = students.filter(
    (s) => absences.get(s.studentId)?.status === "late"
  );
  const earlyLeaveStudents = students.filter(
    (s) => absences.get(s.studentId)?.status === "early_leave"
  );
  const absentStudents = students.filter((s) => {
    const a = absences.get(s.studentId);
    return a && a.status !== "late" && a.status !== "early_leave";
  });
  const presentCount = students.length - absentStudents.length;
  const absentCount = absentStudents.length;
  const lateCount = lateStudents.length;
  const earlyLeaveCount = earlyLeaveStudents.length;

  return (
    <main className="min-h-screen p-6 max-w-lg md:max-w-4xl lg:max-w-6xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}</h1>
          <p className="text-xs text-gray-400">{classNameToEnglish(selectedClass)}</p>
          <p className="text-sm text-gray-500">{date}</p>
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
          onClick={() => setDate((d) => addDays(d, -1))}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="前日 / Previous day"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-48 text-center">{formatDateLabel(date)}</p>
        <button
          onClick={() => setDate((d) => (d < today ? addDays(d, 1) : d))}
          disabled={isToday}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center disabled:opacity-30"
          aria-label="翌日 / Next day"
        >
          ▶
        </button>
        {!isToday && (
          <button
            onClick={() => setDate(today)}
            className="rounded-full bg-gray-100 text-gray-600 px-3 py-1.5 text-xs font-semibold"
          >
            今日に戻る
            <span className="block text-[9px] font-normal opacity-70">Back to today</span>
          </button>
        )}
      </div>

      {!isToday && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-3">
          <p className="text-sm text-orange-800 font-semibold">
            ⚠ {formatDateLabel(date)} の出席を記録しています（本日ではありません）
            <span className="block text-xs font-normal">
              Recording attendance for {formatDateLabel(date)} — not today
            </span>
          </p>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-3 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3">
          <p className="text-sm text-yellow-800">
            ⚠ オフライン保存中の出席が <b>{pendingCount}件</b> あります
            <span className="block text-xs font-normal">
              {pendingCount} attendance record(s) saved offline
            </span>
          </p>
          <button
            onClick={syncPending}
            disabled={syncing}
            className="shrink-0 text-sm font-semibold text-yellow-900 border border-yellow-400 rounded-full px-3 py-1 disabled:opacity-40"
          >
            {syncing ? "送信中... / Sending..." : "今すぐ送信 / Send now"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中... / Loading...</p>
      ) : students.length === 0 ? (
        <div className="flex flex-col gap-3 items-start">
          <p className="text-gray-500 text-sm">
            このクラスにはまだ生徒が登録されていません
            <span className="block text-xs">No students registered in this class yet</span>
          </p>
          <Link
            href="/students"
            className="text-blue-600 underline text-sm"
          >
            生徒を追加する / Add students
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            全員デフォルトで出席済みです。休みの生徒だけタップしてください
            <span className="block text-xs text-gray-400">
              Everyone starts marked present — tap only the students who are absent
            </span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {students.map((s, i) => {
              const label = s.nameEnglish || s.nameKanji;
              const absence = absences.get(s.studentId);
              const isSuspended = absence?.status === "suspended";
              const isAbsent = absence?.status === "absent";
              const isLate = absence?.status === "late";
              const isEarlyLeave = absence?.status === "early_leave";
              return (
                <button
                  key={s.studentId}
                  onClick={() => handleStudentClick(s.studentId, label)}
                  className={`relative rounded-xl border-2 px-3 py-6 text-center font-medium transition ${
                    isSuspended
                      ? "bg-purple-50 border-purple-500 text-purple-800"
                      : isAbsent
                        ? "bg-red-50 border-red-500 text-red-800"
                        : isLate
                          ? "bg-amber-50 border-amber-500 text-amber-800"
                          : isEarlyLeave
                            ? "bg-blue-50 border-blue-500 text-blue-800"
                            : "bg-green-50 border-green-400 text-green-800"
                  }`}
                >
                  <span className="absolute top-1 left-2 text-xs font-normal text-gray-400">
                    {i + 1}
                  </span>
                  {label}
                  {absence && (
                    <span className="block text-[10px] font-normal mt-0.5">
                      {absence.reason || (isLate ? "遅刻" : isEarlyLeave ? "早退" : "")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <p className="text-sm">
              出席: <span className="font-bold">{presentCount}</span> / 遅刻:{" "}
              <span className="font-bold">{lateCount}</span> / 早退:{" "}
              <span className="font-bold">{earlyLeaveCount}</span> / 欠席:{" "}
              <span className="font-bold">{absentCount}</span>
              <span className="block text-xs text-gray-400">
                Present: {presentCount} / Late: {lateCount} / Early leave: {earlyLeaveCount} /
                Absent: {absentCount}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push("/dashboard")}
                disabled={submitting}
                className="rounded-full bg-gray-100 text-gray-600 px-6 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル
                <span className="block text-[10px] font-normal opacity-70">Cancel</span>
              </button>
              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={submitting}
                className="rounded-full bg-green-600 text-white px-6 py-3 font-semibold disabled:opacity-40"
              >
                確定する
                <span className="block text-[10px] font-normal opacity-70">Confirm</span>
              </button>
            </div>
          </div>

          {submitted && !queuedOffline && (
            <p className="text-green-700 font-semibold">
              ✓ 出席を記録しました
              <span className="block text-xs font-normal">Attendance recorded</span>
            </p>
          )}
          {submitted && queuedOffline && (
            <p className="text-yellow-800 font-semibold">
              📶 オフラインのため端末に保存しました。オンラインになったら自動で送信します
              <span className="block text-xs font-normal">
                Saved on device (offline) — will send automatically once back online
              </span>
            </p>
          )}
        </>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <Link href="/students" className="text-xs text-gray-400 underline mt-4">
        生徒一覧の管理 / Manage student list
      </Link>

      {/* Reason picker — opens when tapping a present student to mark them out */}
      {reasonPickerFor && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => setReasonPickerFor(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-xs flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-bold text-center">{reasonPickerFor.label}</p>
            <p className="text-xs text-gray-500 text-center mb-1">
              状況を選んでください
              <span className="block">Please choose an option</span>
            </p>

            {!showOtherInput ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={pickLate}
                  className="rounded-full border py-3 font-semibold bg-amber-50 border-amber-400 text-amber-800"
                >
                  遅刻
                  <span className="block text-[10px] font-normal opacity-70">Late</span>
                </button>
                <button
                  onClick={pickEarlyLeave}
                  className="rounded-full border py-3 font-semibold bg-blue-50 border-blue-400 text-blue-800"
                >
                  早退
                  <span className="block text-[10px] font-normal opacity-70">Early leave</span>
                </button>
                {REASON_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => pickReason(opt.label, opt.status)}
                    className={`rounded-full border py-3 font-semibold ${
                      opt.status === "suspended"
                        ? "bg-purple-50 border-purple-400 text-purple-800"
                        : "bg-red-50 border-red-400 text-red-700"
                    }`}
                  >
                    {opt.label}
                    <span className="block text-[10px] font-normal opacity-70">{opt.en}</span>
                  </button>
                ))}
                <button
                  onClick={() => setShowOtherInput(true)}
                  className="rounded-full bg-gray-100 text-gray-600 font-semibold py-3"
                >
                  その他
                  <span className="block text-[10px] font-normal opacity-70">Other</span>
                </button>
                <button
                  onClick={() => setReasonPickerFor(null)}
                  className="text-sm text-gray-400 underline mt-1"
                >
                  キャンセル / Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder="理由を入力 / Enter reason"
                  autoFocus
                  className="border rounded-lg px-3 py-2"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setOtherStatus("absent")}
                    className={`flex-1 rounded-full border py-2 text-sm font-semibold ${
                      otherStatus === "absent"
                        ? "bg-red-50 border-red-400 text-red-700"
                        : "border-gray-200 text-gray-400"
                    }`}
                  >
                    欠席として
                    <span className="block text-[10px] font-normal opacity-70">As absent</span>
                  </button>
                  <button
                    onClick={() => setOtherStatus("suspended")}
                    className={`flex-1 rounded-full border py-2 text-sm font-semibold ${
                      otherStatus === "suspended"
                        ? "bg-purple-50 border-purple-400 text-purple-800"
                        : "border-gray-200 text-gray-400"
                    }`}
                  >
                    出停として
                    <span className="block text-[10px] font-normal opacity-70">
                      As suspended
                    </span>
                  </button>
                </div>
                <button
                  onClick={applyOtherReason}
                  disabled={!otherText.trim()}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
                >
                  適用する / Apply
                </button>
                <button
                  onClick={() => setShowOtherInput(false)}
                  className="text-sm text-gray-400 underline"
                >
                  戻る / Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h2 className="text-lg font-bold text-center">
              {isToday ? (
                <>
                  本日の出席状況
                  <span className="block text-sm font-normal text-gray-500">
                    Today&apos;s attendance
                  </span>
                </>
              ) : (
                <>
                  {formatDateLabel(date)}の出席状況
                  <span className="block text-sm font-normal text-orange-600">
                    ⚠ Not today — {date}
                  </span>
                </>
              )}
            </h2>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-3xl font-bold text-green-700">
                  {presentCount}
                </p>
                <p className="text-sm text-gray-500">
                  出席
                  <span className="block text-xs">Present</span>
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-amber-600">
                  {lateCount}
                </p>
                <p className="text-sm text-gray-500">
                  遅刻
                  <span className="block text-xs">Late</span>
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-blue-600">
                  {earlyLeaveCount}
                </p>
                <p className="text-sm text-gray-500">
                  早退
                  <span className="block text-xs">Early leave</span>
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">
                  {absentCount}
                </p>
                <p className="text-sm text-gray-500">
                  欠席
                  <span className="block text-xs">Absent</span>
                </p>
              </div>
            </div>
            {earlyLeaveStudents.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">早退の生徒: / Early-leave students:</p>
                <ul className="flex flex-wrap gap-2">
                  {earlyLeaveStudents.map((s) => (
                    <li
                      key={s.studentId}
                      className="text-xs bg-blue-50 text-blue-800 rounded-full px-3 py-1"
                    >
                      {s.nameEnglish || s.nameKanji}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lateStudents.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">遅刻の生徒: / Late students:</p>
                <ul className="flex flex-wrap gap-2">
                  {lateStudents.map((s) => (
                    <li
                      key={s.studentId}
                      className="text-xs bg-amber-50 text-amber-800 rounded-full px-3 py-1"
                    >
                      {s.nameEnglish || s.nameKanji}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {absentStudents.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">欠席の生徒: / Absent students:</p>
                <ul className="flex flex-wrap gap-2">
                  {absentStudents.map((s) => {
                    const absence = absences.get(s.studentId);
                    return (
                      <li
                        key={s.studentId}
                        className="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1"
                      >
                        {s.nameEnglish || s.nameKanji}
                        {absence && ` (${absence.reason})`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-400 text-center">
              この内容で記録します。よろしいですか？
              <span className="block">Record with this content — is that OK?</span>
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                className="flex-1 rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
              >
                {submitting ? "送信中... / Sending..." : "送信する / Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
