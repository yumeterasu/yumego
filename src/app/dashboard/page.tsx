"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToBranchGrade, classNameToEnglish } from "@/lib/classes";
import type { Student, AttendanceStatus } from "@/lib/sheets";
import { REASON_OPTIONS, type AbsenceBucket } from "@/lib/absenceReasons";

// English names for the 5 attendance statuses, used only in the edit
// popup's buttons — NOT in the compact day-by-day grid cells (出/欠/遅/
// 早/出停 stay Japanese-only there, no room to spare).
const STATUS_EN: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  early_leave: "Early leave",
  suspended: "Suspended (illness)",
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

type AttendanceRecord = {
  date: string;
  studentId: string;
  status: AttendanceStatus;
  reason: string;
};

type EditingCell = {
  studentId: string;
  studentLabel: string;
  date: string;
  currentStatus: AttendanceStatus | null;
  currentReason: string;
};

// Friendly Japanese label for a status+reason pair, used in the
// confirm-before-change dialog — prefers the specific reason text (e.g.
// "病欠", "コロナ") over the generic 欠席/出席停止 when one was given.
function statusChangeLabel(status: AttendanceStatus | null, reason: string): string {
  if (status === null) return "空欄（未確認）";
  if (status === "present") return "出席";
  if (status === "late") return "遅刻";
  if (status === "early_leave") return "早退";
  return reason || (status === "suspended" ? "出席停止" : "欠席");
}

// Which button in the edit popup matches the cell's CURRENT value — 欠
// alone doesn't say whether it was 事故欠/病欠/インフルエンザ/etc, so the
// popup highlights the exact one that's actually set (thick ring border).
function isCurrentSelection(
  cell: EditingCell,
  status: AttendanceStatus | null,
  reason: string = ""
): boolean {
  return cell.currentStatus === status && cell.currentReason === reason;
}

// True when the current value is a non-blank status/reason that doesn't
// match any of the fixed buttons — i.e. it was set via a custom "その他"
// reason, so that button is the one to highlight instead.
function isCurrentOther(cell: EditingCell): boolean {
  if (cell.currentStatus === null) return false;
  if (
    cell.currentStatus === "present" ||
    cell.currentStatus === "late" ||
    cell.currentStatus === "early_leave"
  ) {
    return false;
  }
  return !REASON_OPTIONS.some(
    (o) => o.status === cell.currentStatus && o.label === cell.currentReason
  );
}

// 遅刻/早退 count toward 出 (present); 出席停止 counts toward 欠 (absent).
function countsAsPresent(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "early_leave";
}

const STATUS_DISPLAY: Record<AttendanceStatus, { label: string; className: string }> = {
  present: { label: "出", className: "text-green-600" },
  absent: { label: "欠", className: "text-red-600" },
  late: { label: "遅", className: "text-amber-600" },
  early_leave: { label: "早", className: "text-blue-600" },
  suspended: { label: "出停", className: "text-purple-700 text-xs" },
};

function daysInMonth(year: number, month: number) {
  // month is 1-based
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayDateString() {
  return formatDate(new Date());
}

/** Every weekday (Mon-Fri) between start and end, inclusive, YYYY-MM-DD. */
function weekdayRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  // studentId -> this MONTH's check1/2/3 state — チェック1/2/3 are scoped
  // per class+month now (checking one in August has no bearing on
  // September), not a permanent property of the student.
  const [monthlyChecks, setMonthlyChecks] = useState<
    Record<string, { check1: boolean; check2: boolean; check3: boolean }>
  >({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [savingRemarkId, setSavingRemarkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Brief corner notification when a チェック1/2/3 box gets unchecked —
  // lighter-weight than a confirm dialog (these boxes get tapped many
  // times a day and any mistake is immediately visible in the same
  // table), but still surfaces that it happened.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [otherStatus, setOtherStatus] = useState<AbsenceBucket>("absent");

  // Bulk "register a date range in advance" modal (e.g. a known 出席停止
  // period). Unlike single-cell taps, this is allowed to write future
  // dates since opening the modal and picking a range is a deliberate act.
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkStudentId, setBulkStudentId] = useState("");
  const [bulkStartDate, setBulkStartDate] = useState(todayDateString());
  const [bulkEndDate, setBulkEndDate] = useState(todayDateString());
  const [bulkShowOtherInput, setBulkShowOtherInput] = useState(false);
  const [bulkOtherText, setBulkOtherText] = useState("");
  const [bulkOtherStatus, setBulkOtherStatus] = useState<AbsenceBucket>("absent");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState<{
    status: AttendanceStatus;
    reason: string;
    displayLabel: string;
  } | null>(null);

  // Custom, per-class labels for the チェック1/2/3 header cells.
  const [checkLabels, setCheckLabels] = useState({
    check1Label: "",
    check2Label: "",
    check3Label: "",
  });
  const [savingLabelColumn, setSavingLabelColumn] = useState<string | null>(null);
  // Debounce timers so a label also saves while typing (not only on blur) —
  // otherwise typing then hitting refresh before clicking away loses the edit.
  const labelSaveTimers = useRef<
    Partial<Record<"check1Label" | "check2Label" | "check3Label", ReturnType<typeof setTimeout>>>
  >({});
  // Last value actually confirmed saved to the server — kept separate from
  // `checkLabels` (which updates on every keystroke) so "has this changed
  // since the last save?" doesn't just compare the live value to itself.
  const savedCheckLabelsRef = useRef({
    check1Label: "",
    check2Label: "",
    check3Label: "",
  });
  // Columns with an edit not yet confirmed saved — drives the "unsaved
  // changes, leave anyway?" browser confirm on refresh/close.
  const dirtyLabelColumnsRef = useRef<Set<string>>(new Set());

  const today = todayDateString();
  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const [studentsRes, attendanceRes, settingsRes, checksRes] = await Promise.all([
        fetch(`/api/students?class=${encodeURIComponent(selectedClass)}`),
        fetch(
          `/api/attendance?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
        ),
        fetch(
          `/api/class-settings?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
        ),
        fetch(
          `/api/monthly-checks?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
        ),
      ]);
      if (!studentsRes.ok || !attendanceRes.ok) throw new Error("failed");
      const studentsData = await studentsRes.json();
      const attendanceData = await attendanceRes.json();
      const loadedStudents: Student[] = studentsData.students ?? [];
      setStudents(loadedStudents);
      setRecords(attendanceData.records ?? []);
      setRemarks(
        Object.fromEntries(loadedStudents.map((s) => [s.studentId, s.remark ?? ""]))
      );
      const blankLabels = { check1Label: "", check2Label: "", check3Label: "" };
      const labels = settingsRes.ok
        ? ((await settingsRes.json()).labels ?? blankLabels)
        : blankLabels;
      setCheckLabels(labels);
      savedCheckLabelsRef.current = labels;
      dirtyLabelColumnsRef.current.clear();

      type MonthlyCheckRecord = { studentId: string; check1: boolean; check2: boolean; check3: boolean };
      const checks: MonthlyCheckRecord[] = checksRes.ok
        ? ((await checksRes.json()).checks ?? [])
        : [];
      setMonthlyChecks(
        Object.fromEntries(
          checks.map((c) => [c.studentId, { check1: c.check1, check2: c.check2, check3: c.check3 }])
        )
      );
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, yearMonth]);

  async function handleRemarkBlur(studentId: string, value: string) {
    const original = students.find((s) => s.studentId === studentId)?.remark ?? "";
    if (value === original) return;

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
      setRemarks((prev) => ({ ...prev, [studentId]: original }));
    } finally {
      setSavingRemarkId(null);
    }
  }

  async function toggleCheck(studentId: string, column: "check1" | "check2" | "check3") {
    if (!selectedClass) return;
    const student = students.find((s) => s.studentId === studentId);
    const current = monthlyChecks[studentId]?.[column] ?? false;
    const next = !current;

    if (!next && student) {
      const label = student.nameEnglish || student.nameKanji;
      const columnLabel =
        checkLabels[`${column}Label` as const] ||
        { check1: "チェック1", check2: "チェック2", check3: "チェック3" }[column];
      showToast(`${label}：「${columnLabel}」のチェックを外しました`);
    }

    // optimistic update
    setMonthlyChecks((prev) => ({
      ...prev,
      [studentId]: {
        check1: prev[studentId]?.check1 ?? false,
        check2: prev[studentId]?.check2 ?? false,
        check3: prev[studentId]?.check3 ?? false,
        [column]: next,
      },
    }));

    try {
      const res = await fetch("/api/monthly-checks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass, month: yearMonth, studentId, column, value: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setError("チェックの保存に失敗しました / Failed to save checkbox");
      setMonthlyChecks((prev) => ({
        ...prev,
        [studentId]: {
          check1: prev[studentId]?.check1 ?? false,
          check2: prev[studentId]?.check2 ?? false,
          check3: prev[studentId]?.check3 ?? false,
          [column]: current,
        },
      }));
    }
  }

  async function handleCheckLabelBlur(
    column: "check1Label" | "check2Label" | "check3Label",
    value: string
  ) {
    // A debounced auto-save may already be scheduled for this column —
    // cancel it since we're about to save (or already up to date) now.
    if (labelSaveTimers.current[column]) {
      clearTimeout(labelSaveTimers.current[column]);
      delete labelSaveTimers.current[column];
    }

    if (!selectedClass) return;
    // Compare against the last *saved* value, not the live `checkLabels`
    // state — that state is mutated on every keystroke, so comparing
    // against it would always look "unchanged" and skip the save.
    const original = savedCheckLabelsRef.current[column];
    if (value === original) {
      dirtyLabelColumnsRef.current.delete(column);
      return;
    }

    setSavingLabelColumn(column);
    setError(null);
    try {
      const res = await fetch("/api/class-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass, month: yearMonth, column, label: value }),
      });
      if (!res.ok) throw new Error("failed");
      savedCheckLabelsRef.current = { ...savedCheckLabelsRef.current, [column]: value };
      setCheckLabels((prev) => ({ ...prev, [column]: value }));
      dirtyLabelColumnsRef.current.delete(column);
    } catch {
      setError("見出しの保存に失敗しました / Failed to save header label");
      // leave the column marked dirty — the next blur/retry will try again,
      // and beforeunload will keep warning before it's actually saved
    } finally {
      setSavingLabelColumn(null);
    }
  }

  // Save shortly after typing stops, so an edit isn't lost if the user
  // refreshes or navigates away before ever blurring the field.
  function scheduleLabelSave(
    column: "check1Label" | "check2Label" | "check3Label",
    value: string
  ) {
    if (labelSaveTimers.current[column]) {
      clearTimeout(labelSaveTimers.current[column]);
    }
    labelSaveTimers.current[column] = setTimeout(() => {
      delete labelSaveTimers.current[column];
      handleCheckLabelBlur(column, value);
    }, 800);
  }

  function handleLabelChange(
    column: "check1Label" | "check2Label" | "check3Label",
    value: string
  ) {
    setCheckLabels((prev) => ({ ...prev, [column]: value }));
    dirtyLabelColumnsRef.current.add(column);
    scheduleLabelSave(column, value);
  }

  // Switching class (or leaving the page) should never let a pending
  // debounced save from the previous class land against the new one.
  useEffect(() => {
    return () => {
      Object.values(labelSaveTimers.current).forEach((t) => clearTimeout(t));
      labelSaveTimers.current = {};
      dirtyLabelColumnsRef.current.clear();
    };
  }, [selectedClass]);

  // Warn before leaving/refreshing if a label edit hasn't been confirmed
  // saved yet (native browser confirm dialog — the exact text is set by
  // the browser itself, not customizable, but it does block the navigation
  // until the user confirms).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyLabelColumnsRef.current.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

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

  function openEditor(
    studentId: string,
    studentLabel: string,
    date: string,
    currentStatus: AttendanceStatus | null,
    currentReason: string
  ) {
    setShowOtherInput(false);
    setOtherText("");
    setOtherStatus("absent");
    setEditingCell({ studentId, studentLabel, date, currentStatus, currentReason });
  }

  async function applyEdit(next: AttendanceStatus | null, reason: string = "") {
    if (!selectedClass || !editingCell) return;
    const { studentId, date, currentStatus, currentReason } = editingCell;
    const key = `${studentId}|${date}`;

    // Confirm before actually overwriting a cell that already had a
    // different value — prevents a stray/accidental tap from silently
    // changing real attendance data. Setting a still-blank cell, or
    // re-picking the same value it already had, needs no confirmation.
    const isRealChange = next !== currentStatus || reason !== currentReason;
    if (currentStatus !== null && isRealChange) {
      const fromLabel = statusChangeLabel(currentStatus, currentReason);
      const toLabel = statusChangeLabel(next, reason);
      if (
        !window.confirm(
          `${editingCell.studentLabel}　${date}\n「${fromLabel}」から「${toLabel}」に変更しますか？\n\nChange from "${fromLabel}" to "${toLabel}"?`
        )
      ) {
        return; // leave the popup open so they can pick again
      }
    }

    setEditingCell(null);

    // optimistic update
    const previous = records;
    setRecords((prev) => {
      const others = prev.filter(
        (r) => !(r.studentId === studentId && r.date === date)
      );
      return next === null
        ? others
        : [...others, { date, studentId, status: next, reason }];
    });
    setSavingKey(key);
    setError(null);

    try {
      const res = await fetch("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, className: selectedClass, studentId, status: next, reason }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setRecords(previous); // revert
      setError("修正の保存に失敗しました。もう一度お試しください / Failed to save the correction, please try again");
    } finally {
      setSavingKey(null);
    }
  }

  function openBulkModal() {
    setBulkStudentId(students[0]?.studentId ?? "");
    setBulkStartDate(today);
    setBulkEndDate(today);
    setBulkShowOtherInput(false);
    setBulkOtherText("");
    setBulkOtherStatus("absent");
    setBulkError(null);
    setBulkPending(null);
    setShowBulkModal(true);
  }

  // Tapping a status button doesn't save anything yet — it just moves to
  // a confirmation screen showing who/when/what before writing anything.
  function selectBulkChoice(status: AttendanceStatus, reason: string, displayLabel: string) {
    if (bulkEndDate < bulkStartDate) {
      setBulkError("終了日は開始日より後にしてください / End date must be after the start date");
      return;
    }
    if (weekdayRange(bulkStartDate, bulkEndDate).length === 0) {
      setBulkError("平日が含まれていません / No weekdays in this range");
      return;
    }
    setBulkError(null);
    setBulkPending({ status, reason, displayLabel });
  }

  async function confirmBulk() {
    if (!selectedClass || !bulkStudentId || !bulkPending) return;
    const { status, reason } = bulkPending;

    const dates = weekdayRange(bulkStartDate, bulkEndDate);
    if (dates.length === 0) {
      setBulkError("平日が含まれていません / No weekdays in this range");
      return;
    }

    setBulkApplying(true);
    setBulkError(null);
    setBulkProgress({ done: 0, total: dates.length });

    let failures = 0;
    for (let i = 0; i < dates.length; i++) {
      try {
        const res = await fetch("/api/attendance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: dates[i],
            className: selectedClass,
            studentId: bulkStudentId,
            status,
            reason,
          }),
        });
        if (!res.ok) failures++;
      } catch {
        failures++;
      }
      setBulkProgress({ done: i + 1, total: dates.length });
      if (i < dates.length - 1) await sleep(350); // pace requests to stay under quota
    }

    setBulkApplying(false);
    setBulkProgress(null);

    if (failures > 0) {
      setBulkError(
        `${failures}件の登録に失敗しました。もう一度お試しください / ${failures} entries failed, please try again`
      );
    } else {
      setShowBulkModal(false);
      setBulkPending(null);
    }
    await load(); // refresh the grid with whatever succeeded
  }

  if (!loaded || !selectedClass) return null;

  // 専門コーチ (and the Reset button on 生徒管理) are scoped to the
  // 長/中/少 grade continuum — 小学生 classes don't have a grade row there,
  // so hide the button rather than let it silently bounce back from a
  // dead-end redirect.
  const hasBranchGrade = classNameToBranchGrade(selectedClass) !== null;

  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  // recordMap[studentId][day] = status, reasonMap[studentId][day] = reason.
  // Both keyed by day (not just pushed from the raw records array) so a
  // stray duplicate row for the same day only ever counts once — matching
  // what's actually shown in that day's cell.
  const recordMap = new Map<string, Map<number, AttendanceStatus>>();
  const reasonMap = new Map<string, Map<number, string>>();
  for (const r of records) {
    const day = Number(r.date.slice(8, 10));
    if (!recordMap.has(r.studentId)) recordMap.set(r.studentId, new Map());
    recordMap.get(r.studentId)!.set(day, r.status);
    if (r.reason) {
      if (!reasonMap.has(r.studentId)) reasonMap.set(r.studentId, new Map());
      reasonMap.get(r.studentId)!.set(day, r.reason);
    }
  }

  // reasonCountMap[studentId] = "reason label" -> number of days that month
  const reasonCountMap = new Map<string, Map<string, number>>();
  for (const [studentId, dayReasons] of reasonMap) {
    const counts = new Map<string, number>();
    for (const reason of dayReasons.values()) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    reasonCountMap.set(studentId, counts);
  }

  // how many students were present (出/遅/早) on each day of the month
  const dailyPresentCounts = dayNumbers.map((day) => {
    let count = 0;
    for (const dayMap of recordMap.values()) {
      const status = dayMap.get(day);
      if (status && countsAsPresent(status)) count++;
    }
    return count;
  });

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}</h1>
          <p className="text-xs text-gray-400">{classNameToEnglish(selectedClass)}</p>
          <p className="text-sm text-gray-500">
            出席簿
            <span className="ml-1 text-xs text-gray-400">Attendance Register</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/students"
            className="rounded-full bg-gray-100 text-gray-600 px-5 py-2.5 font-semibold text-sm"
          >
            生徒管理
            <span className="block text-[10px] font-normal opacity-70">
              Manage Students
            </span>
          </Link>
          <Link
            href="/dashboard/summary"
            className="rounded-full bg-gray-100 text-gray-600 px-5 py-2.5 font-semibold text-sm"
          >
            年間まとめ
            <span className="block text-[10px] font-normal opacity-70">Annual Summary</span>
          </Link>
          {hasBranchGrade && (
            <Link
              href="/dashboard/specialist"
              className="rounded-full bg-gray-100 text-gray-600 px-5 py-2.5 font-semibold text-sm"
            >
              専門コーチ
              <span className="block text-[10px] font-normal opacity-70">
                Specialist Coach
              </span>
            </Link>
          )}
          <Link
            href="/dashboard/outings"
            className="rounded-full bg-gray-100 text-gray-600 px-5 py-2.5 font-semibold text-sm"
          >
            入退出記録
            <span className="block text-[10px] font-normal opacity-70">
              Entry/Exit Log
            </span>
          </Link>
          <Link
            href="/attendance"
            className="rounded-full bg-green-600 text-white px-5 py-2.5 font-semibold text-sm"
          >
            出席確認
            <span className="block text-[10px] font-normal opacity-70">
              Take Attendance
            </span>
          </Link>
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
              (window.location.href = `/api/export/monthly?class=${encodeURIComponent(
                selectedClass
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

      <p className="text-xs text-gray-400 text-center print:hidden">
        過去の日付、または登録済みの未来日のマスをタップすると修正メニューが開きます（出/欠/遅/早/出停）
        <span className="block">
          Tap a past date, or a future date that already has data, to open the edit menu
        </span>
      </p>

      <button
        onClick={openBulkModal}
        className="self-center rounded-full border border-purple-400 text-purple-800 bg-purple-50 px-5 py-2 text-sm font-semibold print:hidden"
      >
        📅 期間で登録（未来日もOK）
        <span className="block text-[10px] font-normal opacity-70">
          Register a date range (future dates OK)
        </span>
      </button>

      {error && <p className="text-red-600 text-sm text-center print:hidden">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : students.length === 0 ? (
        <p className="text-gray-500 text-sm text-center">
          このクラスにはまだ生徒が登録されていません
          <span className="block text-xs">No students registered in this class yet</span>
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max print-table-monthly">
            <thead>
              <tr>
                <th
                  colSpan={2}
                  className="sticky left-0 bg-gray-100 border border-gray-300 px-2 py-1 text-right text-xs font-normal text-gray-500 whitespace-nowrap z-10"
                >
                  出席人数
                  <span className="block text-[9px]">Daily count</span>
                </th>
                {dailyPresentCounts.map((count, idx) => (
                  <th
                    key={dayNumbers[idx]}
                    className="border border-gray-300 text-center text-xs font-normal bg-gray-50 text-gray-600"
                  >
                    {count > 0 ? count : ""}
                  </th>
                ))}
                <th colSpan={7} className="border border-gray-300 bg-gray-50" />
              </tr>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-2 py-1 text-center whitespace-nowrap z-10 w-8">
                  #
                </th>
                <th className="sticky left-8 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10">
                  名前
                  <span className="block text-[9px] font-normal text-gray-400">Name</span>
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
                <th className="border border-gray-300 px-2 py-2 bg-red-50 text-red-700 w-10 whitespace-nowrap">
                  欠
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-red-50/40 text-red-700 whitespace-nowrap">
                  欠席理由
                  <span className="block text-[9px] font-normal">Absence Reason</span>
                </th>
                <th className="border border-gray-300 px-1 py-1 bg-cyan-100 text-cyan-800 w-14">
                  <input
                    type="text"
                    value={checkLabels.check1Label}
                    placeholder="未設定 / Not set"
                    disabled={savingLabelColumn === "check1Label"}
                    onChange={(e) => handleLabelChange("check1Label", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => handleCheckLabelBlur("check1Label", e.target.value)}
                    className="w-full bg-transparent text-center text-cyan-800 placeholder-cyan-500/70 outline-none focus:bg-white/60 rounded px-0.5"
                  />
                </th>
                <th className="border border-gray-300 px-1 py-1 bg-pink-100 text-pink-800 w-14">
                  <input
                    type="text"
                    value={checkLabels.check2Label}
                    placeholder="未設定 / Not set"
                    disabled={savingLabelColumn === "check2Label"}
                    onChange={(e) => handleLabelChange("check2Label", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => handleCheckLabelBlur("check2Label", e.target.value)}
                    className="w-full bg-transparent text-center text-pink-800 placeholder-pink-500/70 outline-none focus:bg-white/60 rounded px-0.5"
                  />
                </th>
                <th className="border border-gray-300 px-1 py-1 bg-lime-100 text-lime-800 w-14">
                  <input
                    type="text"
                    value={checkLabels.check3Label}
                    placeholder="未設定 / Not set"
                    disabled={savingLabelColumn === "check3Label"}
                    onChange={(e) => handleLabelChange("check3Label", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => handleCheckLabelBlur("check3Label", e.target.value)}
                    className="w-full bg-transparent text-center text-lime-800 placeholder-lime-600/70 outline-none focus:bg-white/60 rounded px-0.5"
                  />
                </th>
                <th className="border border-gray-300 px-2 py-2 bg-gray-50 text-gray-700 w-40 whitespace-nowrap">
                  備考
                  <span className="block text-[9px] font-normal text-gray-400">Notes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const dayMap = recordMap.get(s.studentId) ?? new Map<number, AttendanceStatus>();
                let presentCount = 0;
                let absentCount = 0;
                for (const status of dayMap.values()) {
                  if (countsAsPresent(status)) presentCount++;
                  else absentCount++;
                }
                const label = s.nameEnglish || s.nameKanji;
                const reasonCounts = reasonCountMap.get(s.studentId);
                const reasonSummary = reasonCounts
                  ? Array.from(reasonCounts.entries())
                      .map(([reason, count]) => `${reason} ${count}`)
                      .join(", ")
                  : "";

                return (
                  <tr key={s.studentId} className={i % 2 === 1 ? "bg-gray-50/50" : ""}>
                    <td
                      className={`sticky left-0 border border-gray-300 px-2 py-1 text-center text-gray-500 ${
                        i % 2 === 1 ? "bg-gray-50" : "bg-white"
                      }`}
                    >
                      {i + 1}
                    </td>
                    <td
                      className={`sticky left-8 border border-gray-300 px-3 py-1 whitespace-nowrap leading-tight ${
                        i % 2 === 1 ? "bg-gray-50" : "bg-white"
                      }`}
                    >
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
                      const status = dayMap.get(day);
                      const reason = reasonMap.get(s.studentId)?.get(day) ?? "";
                      const display = status ? STATUS_DISPLAY[status] : null;
                      const date = `${year}-${pad2(month)}-${pad2(day)}`;
                      const isFuture = date > today;
                      // Blank future days are locked (use 期間で登録 instead)
                      // to avoid casual future taps, but a future day that
                      // already has data (e.g. a mistaken bulk entry) can
                      // still be tapped open to fix or clear it.
                      const isLocked = isFuture && !status;
                      const key = `${s.studentId}|${date}`;
                      const isSaving = savingKey === key;

                      return (
                        <td
                          key={day}
                          onClick={
                            isLocked
                              ? undefined
                              : () =>
                                  openEditor(
                                    s.studentId,
                                    label,
                                    date,
                                    status ?? null,
                                    reason
                                  )
                          }
                          className={`text-center border border-gray-300 py-1 select-none ${
                            isWeekend ? "bg-orange-50/60" : ""
                          } ${
                            isLocked
                              ? ""
                              : "cursor-pointer hover:bg-blue-50 active:bg-blue-100"
                          }`}
                        >
                          {isSaving ? (
                            <span className="text-gray-300">…</span>
                          ) : display ? (
                            <span className={`font-bold ${display.className}`}>
                              {display.label}
                            </span>
                          ) : (
                            ""
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center border border-gray-300 font-semibold text-green-700">
                      {presentCount}
                    </td>
                    <td className="text-center border border-gray-300 font-semibold text-red-600">
                      {absentCount}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-xs text-gray-600 whitespace-nowrap">
                      {reasonSummary}
                    </td>
                    <td className="text-center border border-gray-300 bg-cyan-50/40">
                      <input
                        type="checkbox"
                        checked={monthlyChecks[s.studentId]?.check1 ?? false}
                        onChange={() => toggleCheck(s.studentId, "check1")}
                        className="w-4 h-4 accent-cyan-600 cursor-pointer"
                      />
                    </td>
                    <td className="text-center border border-gray-300 bg-pink-50/40">
                      <input
                        type="checkbox"
                        checked={monthlyChecks[s.studentId]?.check2 ?? false}
                        onChange={() => toggleCheck(s.studentId, "check2")}
                        className="w-4 h-4 accent-pink-600 cursor-pointer"
                      />
                    </td>
                    <td className="text-center border border-gray-300 bg-lime-50/40">
                      <input
                        type="checkbox"
                        checked={monthlyChecks[s.studentId]?.check3 ?? false}
                        onChange={() => toggleCheck(s.studentId, "check3")}
                        className="w-4 h-4 accent-lime-600 cursor-pointer"
                      />
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

      {editingCell && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => setEditingCell(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <p className="font-bold">{editingCell.studentLabel}</p>
              <p className="text-sm text-gray-500">{editingCell.date}</p>
            </div>

            {!showOtherInput ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => applyEdit("present")}
                    className={`rounded-full bg-green-50 border border-green-400 text-green-800 font-semibold py-2.5 text-sm ${
                      isCurrentSelection(editingCell, "present") ? "ring-4 ring-green-600" : ""
                    }`}
                  >
                    出席
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.present}
                    </span>
                  </button>
                  <button
                    onClick={() => applyEdit("late")}
                    className={`rounded-full bg-amber-50 border border-amber-400 text-amber-800 font-semibold py-2.5 text-sm ${
                      isCurrentSelection(editingCell, "late") ? "ring-4 ring-amber-600" : ""
                    }`}
                  >
                    遅刻
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.late}
                    </span>
                  </button>
                  <button
                    onClick={() => applyEdit("early_leave")}
                    className={`rounded-full bg-blue-50 border border-blue-400 text-blue-800 font-semibold py-2.5 text-sm ${
                      isCurrentSelection(editingCell, "early_leave") ? "ring-4 ring-blue-600" : ""
                    }`}
                  >
                    早退
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.early_leave}
                    </span>
                  </button>
                  {REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => applyEdit(opt.status, opt.label)}
                      className={`rounded-full border py-2.5 text-sm font-semibold ${
                        opt.status === "suspended"
                          ? "bg-purple-50 border-purple-400 text-purple-800"
                          : "bg-red-50 border-red-400 text-red-700"
                      } ${
                        isCurrentSelection(editingCell, opt.status, opt.label)
                          ? opt.status === "suspended"
                            ? "ring-4 ring-purple-600"
                            : "ring-4 ring-red-600"
                          : ""
                      }`}
                    >
                      {opt.label}
                      <span className="block text-[10px] font-normal opacity-70">{opt.en}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setShowOtherInput(true)}
                    className={`rounded-full bg-gray-100 text-gray-600 font-semibold py-2.5 text-sm ${
                      isCurrentOther(editingCell) ? "ring-4 ring-gray-600" : ""
                    }`}
                  >
                    その他
                    <span className="block text-[10px] font-normal opacity-70">Other</span>
                  </button>
                </div>
                <button
                  onClick={() => applyEdit(null)}
                  className={`rounded-full bg-white border border-gray-200 text-gray-400 font-semibold py-3 ${
                    isCurrentSelection(editingCell, null) ? "ring-4 ring-gray-400" : ""
                  }`}
                >
                  空欄にする（未確認）
                  <span className="block text-[10px] font-normal">
                    Clear (mark as not checked)
                  </span>
                </button>
                <button
                  onClick={() => setEditingCell(null)}
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
                  onClick={() => applyEdit(otherStatus, otherText.trim())}
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

      {showBulkModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !bulkApplying && setShowBulkModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center">
              期間で登録
              <span className="block text-sm font-normal text-gray-500">
                Register a date range
              </span>
            </h2>
            <p className="text-xs text-gray-400 text-center -mt-2">
              土日は自動でスキップされます
              <span className="block">Weekends are skipped automatically</span>
            </p>

            {bulkPending ? (
              <div className="flex flex-col gap-4">
                <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      生徒
                      <span className="block text-[10px]">Student</span>
                    </span>
                    <span className="font-semibold">
                      {(() => {
                        const s = students.find((s) => s.studentId === bulkStudentId);
                        return s ? s.nameEnglish || s.nameKanji : "";
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      期間
                      <span className="block text-[10px]">Date range</span>
                    </span>
                    <span className="font-semibold">
                      {bulkStartDate} 〜 {bulkEndDate}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      登録日数
                      <span className="block text-[10px]">Days to register</span>
                    </span>
                    <span className="font-semibold">
                      {weekdayRange(bulkStartDate, bulkEndDate).length}日（平日のみ）
                      <span className="block text-[10px] font-normal">
                        {weekdayRange(bulkStartDate, bulkEndDate).length} day(s), weekdays only
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      状態
                      <span className="block text-[10px]">Status</span>
                    </span>
                    <span className="font-bold">{bulkPending.displayLabel}</span>
                  </div>
                </div>

                <p className="text-sm text-center text-gray-600">
                  この内容で登録します。よろしいですか？
                  <span className="block text-xs">Register with this content — is that OK?</span>
                </p>

                {bulkError && <p className="text-red-600 text-sm text-center">{bulkError}</p>}
                {bulkProgress && (
                  <p className="text-sm text-gray-500 text-center">
                    登録中... {bulkProgress.done}/{bulkProgress.total}
                    <span className="block text-xs">
                      Registering... {bulkProgress.done}/{bulkProgress.total}
                    </span>
                  </p>
                )}

                <button
                  onClick={confirmBulk}
                  disabled={bulkApplying}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
                >
                  {bulkApplying ? "登録中... / Registering..." : "登録する / Register"}
                </button>
                <button
                  onClick={() => setBulkPending(null)}
                  disabled={bulkApplying}
                  className="text-sm text-gray-400 underline disabled:opacity-40"
                >
                  戻る（選び直す）/ Back (choose again)
                </button>
              </div>
            ) : !bulkShowOtherInput ? (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  生徒
                  <span className="text-xs font-normal text-gray-500">Student</span>
                  <select
                    value={bulkStudentId}
                    onChange={(e) => setBulkStudentId(e.target.value)}
                    className="border rounded-lg px-3 py-2"
                  >
                    {students.map((s) => (
                      <option key={s.studentId} value={s.studentId}>
                        {s.nameEnglish || s.nameKanji}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex gap-2">
                  <label className="flex-1 flex flex-col gap-1 text-sm">
                    開始日
                    <span className="text-xs font-normal text-gray-500">Start date</span>
                    <input
                      type="date"
                      value={bulkStartDate}
                      onChange={(e) => setBulkStartDate(e.target.value)}
                      className="border rounded-lg px-2 py-2"
                    />
                  </label>
                  <label className="flex-1 flex flex-col gap-1 text-sm">
                    終了日
                    <span className="text-xs font-normal text-gray-500">End date</span>
                    <input
                      type="date"
                      value={bulkEndDate}
                      onChange={(e) => setBulkEndDate(e.target.value)}
                      className="border rounded-lg px-2 py-2"
                    />
                  </label>
                </div>

                {bulkError && <p className="text-red-600 text-sm">{bulkError}</p>}

                <p className="text-xs text-gray-400 text-center mt-1">
                  状態を選択
                  <span className="block">Choose a status</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => selectBulkChoice("present", "", "出席")}
                    disabled={!bulkStudentId}
                    className="rounded-full bg-green-50 border border-green-400 text-green-800 font-semibold py-2.5 text-sm disabled:opacity-40"
                  >
                    出席
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.present}
                    </span>
                  </button>
                  <button
                    onClick={() => selectBulkChoice("late", "", "遅刻")}
                    disabled={!bulkStudentId}
                    className="rounded-full bg-amber-50 border border-amber-400 text-amber-800 font-semibold py-2.5 text-sm disabled:opacity-40"
                  >
                    遅刻
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.late}
                    </span>
                  </button>
                  <button
                    onClick={() => selectBulkChoice("early_leave", "", "早退")}
                    disabled={!bulkStudentId}
                    className="rounded-full bg-blue-50 border border-blue-400 text-blue-800 font-semibold py-2.5 text-sm disabled:opacity-40"
                  >
                    早退
                    <span className="block text-[10px] font-normal opacity-70">
                      {STATUS_EN.early_leave}
                    </span>
                  </button>
                  {REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => selectBulkChoice(opt.status, opt.label, opt.label)}
                      disabled={!bulkStudentId}
                      className={`rounded-full border py-2.5 text-sm font-semibold disabled:opacity-40 ${
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
                    onClick={() => setBulkShowOtherInput(true)}
                    disabled={!bulkStudentId}
                    className="rounded-full bg-gray-100 text-gray-600 font-semibold py-2.5 text-sm disabled:opacity-40"
                  >
                    その他
                    <span className="block text-[10px] font-normal opacity-70">Other</span>
                  </button>
                </div>

                <button
                  onClick={() => setShowBulkModal(false)}
                  className="text-sm text-gray-400 underline mt-1"
                >
                  キャンセル / Cancel
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  value={bulkOtherText}
                  onChange={(e) => setBulkOtherText(e.target.value)}
                  placeholder="理由を入力 / Enter reason"
                  autoFocus
                  className="border rounded-lg px-3 py-2"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setBulkOtherStatus("absent")}
                    className={`flex-1 rounded-full border py-2 text-sm font-semibold ${
                      bulkOtherStatus === "absent"
                        ? "bg-red-50 border-red-400 text-red-700"
                        : "border-gray-200 text-gray-400"
                    }`}
                  >
                    欠席として
                    <span className="block text-[10px] font-normal opacity-70">As absent</span>
                  </button>
                  <button
                    onClick={() => setBulkOtherStatus("suspended")}
                    className={`flex-1 rounded-full border py-2 text-sm font-semibold ${
                      bulkOtherStatus === "suspended"
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
                {bulkError && <p className="text-red-600 text-sm">{bulkError}</p>}
                <button
                  onClick={() =>
                    selectBulkChoice(bulkOtherStatus, bulkOtherText.trim(), bulkOtherText.trim())
                  }
                  disabled={!bulkOtherText.trim()}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
                >
                  次へ / Next
                </button>
                <button
                  onClick={() => setBulkShowOtherInput(false)}
                  className="text-sm text-gray-400 underline"
                >
                  戻る / Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 print:hidden">
          <div className="bg-gray-900 text-white text-sm rounded-full px-4 py-2.5 shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}
