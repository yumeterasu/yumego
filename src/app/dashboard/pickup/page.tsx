"use client";

import { useCallback, useEffect, useRef, useState, Suspense, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Student, PickupRecord, StudentLocation, BusLegMode } from "@/lib/sheets";
import { branchToEnglish, type Branch } from "@/lib/classes";

type BusWeekBucket = { weekStart: string; days: string[]; label: string };
type BusOverride = { studentId: string; date: string; arrivalMode: BusLegMode; departureMode: BusLegMode };

/** The Monday ("YYYY-MM-DD") of the school week containing this date --
 *  mirrors weekStartForDate() in src/lib/sheets.ts. */
function weekStartForDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Buckets every weekday in [startDate, endDate] into its school weeks
 *  (Mon-Fri) -- mirrors getBusWeekBucketsForRange() in src/lib/sheets.ts.
 *  A week whose Mon-Fri span crosses a month boundary becomes a single
 *  bucket covering both months (no per-month splitting/duplication), so
 *  this is safe to call across a whole term at once. */
function getBusWeekBucketsForRange(startDate: string, endDate: string): BusWeekBucket[] {
  const buckets = new Map<string, string[]>();
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const dateStr = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`;
      const weekStart = weekStartForDate(dateStr);
      if (!buckets.has(weekStart)) buckets.set(weekStart, []);
      buckets.get(weekStart)!.push(dateStr);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, days]) => {
      const first = days[0];
      const last = days[days.length - 1];
      const fm = Number(first.slice(5, 7));
      const fd = Number(first.slice(8, 10));
      const lm = Number(last.slice(5, 7));
      const ld = Number(last.slice(8, 10));
      const label =
        fm === lm ? (fd === ld ? `${fd}` : `${fd}-${ld}`) : `${fm}/${fd}-${lm}/${ld}`;
      return { weekStart, days, label };
    });
}

/** Which month ("YYYY-MM") owns this school week -- whichever month has
 *  the majority of its 5 weekdays (5 is odd, so a majority always
 *  exists, never a tie) -- mirrors ownerMonthOfWeek() in
 *  src/lib/sheets.ts. A week can only ever belong to exactly one month
 *  this way, even when its Mon-Fri span crosses a month boundary -- this
 *  is what keeps editing one month's pattern from also touching an
 *  adjacent month's shared boundary week. */
function ownerMonthOfWeek(weekStart: string): string {
  const counts = new Map<string, number>();
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 5; i++) {
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    d.setDate(d.getDate() + 1);
  }
  let bestKey = weekStart.slice(0, 7);
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey;
}

/** Every weekStart this calendar month actually owns -- unlike
 *  getBusWeekBucketsForRange (correct for a continuous multi-month read),
 *  this excludes a boundary week whose majority belongs to the adjacent
 *  month, so setting one month's pattern never reaches into another
 *  month's data. */
function busMonthWeekStarts(year: number, month: number): string[] {
  const yearMonth = `${year}-${pad2(month)}`;
  const lastDay = daysInMonth(year, month);
  return getBusWeekBucketsForRange(`${yearMonth}-01`, `${yearMonth}-${pad2(lastDay)}`)
    .filter((b) => ownerMonthOfWeek(b.weekStart) === yearMonth)
    .map((b) => b.weekStart);
}

const BUS_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "self_self", label: "🚗↔🚗 送迎のみ" },
  { value: "bus_bus", label: "🚌↔🚌 往復バス" },
  { value: "bus_self", label: "🚌→🚗 帰り自分" },
  { value: "self_bus", label: "🚗→🚌 行き自分" },
];

// 学期 (school term) -- バス・送迎設定 pages by term, not by single month,
// since a bus/pickup pattern rarely changes mid-term and staff want to see
// a whole term's weeks together. Matches the Japanese school year exactly
// (see 祝日カレンダー（マスター）'s own FISCAL_MONTHS, same April-start
// convention).
const BUS_TERMS: { months: number[] }[] = [
  { months: [4, 5, 6, 7, 8] },
  { months: [9, 10, 11, 12] },
  { months: [1, 2, 3] },
];

function defaultFiscalYearStart(): number {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

function busTermIndexForMonth(m: number): number {
  if (m >= 4 && m <= 8) return 0;
  if (m >= 9 && m <= 12) return 1;
  return 2;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// Display order for grouping the roster — 小学生 last, matching how it
// was added onto the end of each branch's class list.
const CLASS_ORDER = ["年長", "年中", "年少", "小学生"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function cellKey(studentId: string, date: string) {
  return `${studentId}|${date}`;
}
function classOrderIndex(className: string) {
  const idx = CLASS_ORDER.findIndex((suffix) => className.endsWith(suffix));
  return idx === -1 ? CLASS_ORDER.length : idx;
}

// Dark gray for both weekend days -- deliberately NOT the 出席確認/Dashboard
// red-Sunday/blue-Saturday convention, so this page reads as visually
// distinct from that one at a glance.
function weekendHeaderClasses(dow: number): string {
  if (dow === 0 || dow === 6) return "bg-gray-600 text-gray-50";
  return "bg-gray-50";
}
// Weekend color takes priority over the 降園 row's own light-orange tint
// where the two would otherwise overlap.
function cellBgClass(dow: number, field: "arrival" | "departure"): string {
  if (dow === 0 || dow === 6) return "bg-gray-300";
  return field === "departure" ? "bg-orange-50" : "";
}

function PickupPageInner() {
  const searchParams = useSearchParams();
  const branch = (searchParams.get("branch") ?? "") as Branch | "";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [students, setStudents] = useState<Student[]>([]);
  // "studentId|date" -> confirmed-saved record, kept separate from the
  // live draft text so comparing "did this change?" never compares a
  // value to its own already-mutated self.
  const savedRef = useRef<Map<string, PickupRecord>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // 登園確認 — mirrors /attendance's own card-grid check-in screen (see
  // handleCardTap/submitCheckin below), just 2 states instead of 4. Only
  // ever targets today; opening it always starts everyone present,
  // independent of whatever's already on the grid for today.
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinAbsent, setCheckinAbsent] = useState<Set<string>>(new Set());
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [showCheckinConfirm, setShowCheckinConfirm] = useState(false);

  // 特定の日を削除 — same permanent, no-backup "clear a whole day" pattern
  // as the Dashboard's own DELETE /api/attendance.
  const [showClearDayModal, setShowClearDayModal] = useState(false);
  const [clearDayFinalStep, setClearDayFinalStep] = useState(false);
  const [clearDayDate, setClearDayDate] = useState("");
  const [clearDayApplying, setClearDayApplying] = useState(false);
  const [clearDayError, setClearDayError] = useState<string | null>(null);
  const [clearDayDone, setClearDayDone] = useState<number | null>(null);

  // バス・送迎設定 — 通学方法 lives here now, not on 生徒管理, since in
  // practice it turned out to change week to week (sometimes month to
  // month) per student rather than being a fixed thing set once at
  // registration. Paged by 学期 (school term: 4-8月/9-12月/1-3月) rather
  // than by the main day-grid's single-month nav, since a bus/pickup
  // pattern rarely changes mid-term and staff want a whole term's weeks
  // visible together -- has its own independent year/term state below,
  // separate from the main grid's year/month.
  const [showBusSettings, setShowBusSettings] = useState(false);
  const [busSettingsLoading, setBusSettingsLoading] = useState(false);
  const [busTermFiscalYear, setBusTermFiscalYear] = useState(defaultFiscalYearStart);
  const [busTermIndex, setBusTermIndex] = useState(() => busTermIndexForMonth(now.getMonth() + 1));
  const [busPatternsByWeek, setBusPatternsByWeek] = useState<
    Record<string, Record<string, { arrivalMode: BusLegMode; departureMode: BusLegMode }>>
  >({});
  const [busOverridesByStudent, setBusOverridesByStudent] = useState<
    Record<string, BusOverride[]>
  >({});
  const [locationsByStudent, setLocationsByStudent] = useState<Record<string, StudentLocation>>(
    {}
  );
  const [busPatternSavingId, setBusPatternSavingId] = useState<string | null>(null);
  // Inline "特定の日だけ変更" form -- one open at a time, keyed by studentId.
  const [overrideFormFor, setOverrideFormFor] = useState<string | null>(null);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideMode, setOverrideMode] = useState("self_self");
  const [overrideSavingKey, setOverrideSavingKey] = useState<string | null>(null);

  const yearMonth = `${year}-${pad2(month)}`;
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const isViewingCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pickup?branch=${encodeURIComponent(branch)}&month=${yearMonth}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const loadedStudents: Student[] = data.students ?? [];
      loadedStudents.sort((a, b) => classOrderIndex(a.className) - classOrderIndex(b.className));
      setStudents(loadedStudents);

      const records: PickupRecord[] = data.records ?? [];
      const saved = new Map<string, PickupRecord>();
      const nextDrafts: Record<string, string> = {};
      for (const r of records) {
        const key = cellKey(r.studentId, r.date);
        saved.set(key, r);
        nextDrafts[`${key}|arrival`] = r.arrivalTime;
        nextDrafts[`${key}|departure`] = r.departureTime;
      }
      savedRef.current = saved;
      setDrafts(nextDrafts);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [branch, yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  // バス・送迎設定's own term (学期) navigation -- 4-8月/9-12月/1-3月,
  // independent of the main grid's year/month above.
  const busTermMonths = BUS_TERMS[busTermIndex].months;
  const busTermMonthYears = busTermMonths.map((m) => ({
    year: m >= 4 ? busTermFiscalYear : busTermFiscalYear + 1,
    month: m,
  }));
  const busTermStartDate = `${busTermMonthYears[0].year}-${pad2(busTermMonthYears[0].month)}-01`;
  const busTermLastMY = busTermMonthYears[busTermMonthYears.length - 1];
  const busTermEndDate = `${busTermLastMY.year}-${pad2(busTermLastMY.month)}-${pad2(daysInMonth(busTermLastMY.year, busTermLastMY.month))}`;
  const busTermLabel = `${busTermFiscalYear}年度 ${busTermMonths[0]}-${busTermMonths[busTermMonths.length - 1]}月`;

  function goPrevBusTerm() {
    if (busTermIndex === 0) {
      setBusTermFiscalYear((y) => y - 1);
      setBusTermIndex(2);
    } else {
      setBusTermIndex((i) => i - 1);
    }
  }
  function goNextBusTerm() {
    if (busTermIndex === 2) {
      setBusTermFiscalYear((y) => y + 1);
      setBusTermIndex(0);
    } else {
      setBusTermIndex((i) => i + 1);
    }
  }

  useEffect(() => {
    if (!showBusSettings) return;
    loadBusSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBusSettings, busTermFiscalYear, busTermIndex]);

  async function loadBusSettings() {
    setBusSettingsLoading(true);
    setError(null);
    try {
      const [patternRes, overrideRes, locationRes] = await Promise.all([
        fetch(`/api/students/bus-pattern?start=${busTermStartDate}&end=${busTermEndDate}`),
        fetch(`/api/students/bus-override?start=${busTermStartDate}&end=${busTermEndDate}`),
        fetch("/api/students/location"),
      ]);
      if (patternRes.ok) {
        const data = await patternRes.json();
        const map: Record<string, Record<string, { arrivalMode: BusLegMode; departureMode: BusLegMode }>> = {};
        for (const p of (data.patterns ?? []) as {
          studentId: string;
          weekStart: string;
          arrivalMode: BusLegMode;
          departureMode: BusLegMode;
        }[]) {
          if (!map[p.weekStart]) map[p.weekStart] = {};
          map[p.weekStart][p.studentId] = { arrivalMode: p.arrivalMode, departureMode: p.departureMode };
        }
        setBusPatternsByWeek(map);
      }
      if (overrideRes.ok) {
        const data = await overrideRes.json();
        const map: Record<string, BusOverride[]> = {};
        for (const o of (data.overrides ?? []) as BusOverride[]) {
          if (!map[o.studentId]) map[o.studentId] = [];
          map[o.studentId].push(o);
        }
        for (const list of Object.values(map)) list.sort((a, b) => a.date.localeCompare(b.date));
        setBusOverridesByStudent(map);
      }
      if (locationRes.ok) {
        const data = await locationRes.json();
        const map: Record<string, StudentLocation> = {};
        for (const loc of (data.locations ?? []) as StudentLocation[]) map[loc.studentId] = loc;
        setLocationsByStudent(map);
      }
    } catch {
      setError("バス・送迎設定の取得に失敗しました / Failed to load bus/pickup settings");
    } finally {
      setBusSettingsLoading(false);
    }
  }

  /** The pattern shown for one student in one month -- the first
   *  non-default value found among that month's weeks (in practice every
   *  week within a month is uniform, since バス・送迎設定 only ever
   *  writes a whole month at a time now). undefined means default
   *  (送迎のみ, self/self). */
  function monthPatternFor(studentId: string, year: number, month: number) {
    for (const weekStart of busMonthWeekStarts(year, month)) {
      const p = busPatternsByWeek[weekStart]?.[studentId];
      if (p) return p;
    }
    return undefined;
  }

  async function setBusPatternForMonth(
    student: Student,
    year: number,
    month: number,
    arrivalMode: BusLegMode,
    departureMode: BusLegMode
  ) {
    const yearMonth = `${year}-${pad2(month)}`;
    setBusPatternSavingId(`${student.studentId}|${yearMonth}`);
    setError(null);
    try {
      const res = await fetch("/api/students/bus-pattern", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.studentId,
          month: yearMonth,
          arrivalMode,
          departureMode,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const weekStarts = busMonthWeekStarts(year, month);
      setBusPatternsByWeek((prev) => {
        const next = { ...prev };
        for (const weekStart of weekStarts) {
          next[weekStart] = { ...(next[weekStart] ?? {}) };
          if (arrivalMode === "self" && departureMode === "self") {
            delete next[weekStart][student.studentId]; // back to default, matches server-side delete
          } else {
            next[weekStart][student.studentId] = { arrivalMode, departureMode };
          }
        }
        return next;
      });
    } catch {
      setError("バス・送迎設定の更新に失敗しました / Failed to update bus/pickup setting");
    } finally {
      setBusPatternSavingId(null);
    }
  }

  /** Changing the term's first month (4月/9月/1月) is the "set the whole
   *  term" action -- cascades the same pattern to every other month in
   *  the term too. Changing any other month only ever touches that one
   *  month (handled by setBusPatternForMonth directly, called from the
   *  dropdown below) -- covers the "parent asks for a change just one
   *  month" case without disturbing the rest of the term. */
  function busTermCascadeKey(studentId: string) {
    return `${studentId}|__term_cascade__`;
  }

  async function setBusPatternForWholeTerm(
    student: Student,
    arrivalMode: BusLegMode,
    departureMode: BusLegMode
  ) {
    setBusPatternSavingId(busTermCascadeKey(student.studentId));
    setError(null);
    try {
      // One batched request covering every month in the term, instead of
      // looping a separate PATCH per month -- the old loop meant a
      // 5-month term cascade could take 10+ sequential Sheets API round
      // trips; this is a single one.
      const months = busTermMonthYears.map((my) => `${my.year}-${pad2(my.month)}`);
      const res = await fetch("/api/students/bus-pattern", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, months, arrivalMode, departureMode }),
      });
      if (!res.ok) throw new Error("failed");
      const weekStarts = new Set<string>();
      for (const my of busTermMonthYears) {
        for (const ws of busMonthWeekStarts(my.year, my.month)) weekStarts.add(ws);
      }
      setBusPatternsByWeek((prev) => {
        const next = { ...prev };
        for (const weekStart of weekStarts) {
          next[weekStart] = { ...(next[weekStart] ?? {}) };
          if (arrivalMode === "self" && departureMode === "self") {
            delete next[weekStart][student.studentId];
          } else {
            next[weekStart][student.studentId] = { arrivalMode, departureMode };
          }
        }
        return next;
      });
    } catch {
      setError("バス・送迎設定の更新に失敗しました / Failed to update bus/pickup setting");
    } finally {
      setBusPatternSavingId(null);
    }
  }

  function openOverrideForm(student: Student) {
    setOverrideFormFor(student.studentId);
    const defaultDate =
      todayStr >= busTermStartDate && todayStr <= busTermEndDate ? todayStr : busTermStartDate;
    setOverrideDate(defaultDate);
    setOverrideModeForDate(student, defaultDate);
  }

  /** Pre-fills the ⚡ form's mode dropdown for whichever date is currently
   *  selected -- from that date's own override if one already exists
   *  (so re-opening a day that already has an exception doesn't silently
   *  show/save the week's default instead), falling back to the month's
   *  pattern otherwise. */
  function setOverrideModeForDate(student: Student, date: string) {
    const existing = (busOverridesByStudent[student.studentId] ?? []).find((o) => o.date === date);
    if (existing) {
      setOverrideMode(`${existing.arrivalMode}_${existing.departureMode}`);
      return;
    }
    const d = new Date(date + "T00:00:00");
    const pattern = monthPatternFor(student.studentId, d.getFullYear(), d.getMonth() + 1);
    setOverrideMode(`${pattern?.arrivalMode ?? "self"}_${pattern?.departureMode ?? "self"}`);
  }

  async function saveOverride(student: Student) {
    const [arrivalMode, departureMode] = overrideMode.split("_") as [BusLegMode, BusLegMode];
    const key = `${student.studentId}|${overrideDate}`;
    setOverrideSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/students/bus-override", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.studentId,
          date: overrideDate,
          arrivalMode,
          departureMode,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setBusOverridesByStudent((prev) => {
        const next = { ...prev };
        const list = (next[student.studentId] ?? []).filter((o) => o.date !== overrideDate);
        list.push({ studentId: student.studentId, date: overrideDate, arrivalMode, departureMode });
        list.sort((a, b) => a.date.localeCompare(b.date));
        next[student.studentId] = list;
        return next;
      });
      setOverrideFormFor(null);
    } catch {
      setError("特例の保存に失敗しました / Failed to save the one-day exception");
    } finally {
      setOverrideSavingKey(null);
    }
  }

  async function removeOverride(studentId: string, date: string) {
    const key = `${studentId}|${date}`;
    setOverrideSavingKey(key);
    setError(null);
    try {
      const res = await fetch(
        `/api/students/bus-override?studentId=${encodeURIComponent(studentId)}&date=${date}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("failed");
      setBusOverridesByStudent((prev) => {
        const next = { ...prev };
        next[studentId] = (next[studentId] ?? []).filter((o) => o.date !== date);
        return next;
      });
    } catch {
      setError("特例の削除に失敗しました / Failed to remove the one-day exception");
    } finally {
      setOverrideSavingKey(null);
    }
  }

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

  // A checked cell just stores "TRUE" (matching the boolean-string
  // convention used throughout the rest of this app, e.g. Students'
  // active/check1-3 columns) rather than a specific time -- any non-empty
  // value counts as checked, so older rows that still hold a real "HH:MM"
  // from before this change display as checked too, untouched unless the
  // operator taps that specific cell again.
  async function toggleCheck(studentId: string, date: string, field: "arrival" | "departure") {
    const key = cellKey(studentId, date);
    const draftKey = `${key}|${field}`;
    const wasChecked = (drafts[draftKey] ?? "") !== "";
    const nextValue = wasChecked ? "" : "TRUE";

    setSavingKey(draftKey);
    setError(null);
    setDrafts((prev) => ({ ...prev, [draftKey]: nextValue }));
    try {
      const res = await fetch("/api/pickup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          studentId,
          [field === "arrival" ? "arrivalTime" : "departureTime"]: nextValue,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const saved = savedRef.current.get(key);
      const nextSaved: PickupRecord = {
        date,
        studentId,
        arrivalTime: field === "arrival" ? nextValue : (saved?.arrivalTime ?? ""),
        departureTime: field === "departure" ? nextValue : (saved?.departureTime ?? ""),
      };
      savedRef.current.set(key, nextSaved);
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDrafts((prev) => ({ ...prev, [draftKey]: wasChecked ? "TRUE" : "" })); // revert
    } finally {
      setSavingKey(null);
    }
  }

  // 本日は全員登園 — default everyone present for today; tap individual
  // absentees off afterward via the normal per-cell toggle above, same as
  // any other day. One batched write for the whole branch roster instead
  // of tapping in each present student one at a time.
  function openCheckin() {
    setCheckinAbsent(new Set()); // always starts everyone present
    setShowCheckin(true);
  }

  function toggleCheckinCard(studentId: string) {
    setCheckinAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function submitCheckin() {
    setCheckinSubmitting(true);
    setError(null);
    try {
      const entries = students.map((s) => ({
        studentId: s.studentId,
        present: !checkinAbsent.has(s.studentId),
      }));
      const res = await fetch("/api/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayStr, entries }),
      });
      if (!res.ok) throw new Error("failed");
      setDrafts((prev) => {
        const next = { ...prev };
        for (const { studentId, present } of entries) {
          next[`${cellKey(studentId, todayStr)}|arrival`] = present ? "TRUE" : "";
        }
        return next;
      });
      for (const { studentId, present } of entries) {
        const key = cellKey(studentId, todayStr);
        const saved = savedRef.current.get(key);
        savedRef.current.set(key, {
          date: todayStr,
          studentId,
          arrivalTime: present ? "TRUE" : "",
          departureTime: saved?.departureTime ?? "",
        });
      }
      setShowCheckinConfirm(false);
      setShowCheckin(false);
    } catch {
      setError("登園確認の保存に失敗しました / Failed to save arrival check-in");
    } finally {
      setCheckinSubmitting(false);
    }
  }

  function openClearDayModal() {
    setClearDayDate(isViewingCurrentMonth ? todayStr : `${yearMonth}-01`);
    setClearDayFinalStep(false);
    setClearDayError(null);
    setClearDayDone(null);
    setShowClearDayModal(true);
  }

  function pickupCountForDate(date: string) {
    return students.filter((s) => {
      const key = cellKey(s.studentId, date);
      return (drafts[`${key}|arrival`] ?? "") !== "" || (drafts[`${key}|departure`] ?? "") !== "";
    }).length;
  }

  async function handleClearDay() {
    if (!branch) return;
    setClearDayApplying(true);
    setClearDayError(null);
    try {
      const res = await fetch(
        `/api/pickup?branch=${encodeURIComponent(branch)}&date=${clearDayDate}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setClearDayDone(data.count ?? 0);
      await load();
    } catch {
      setClearDayError("削除に失敗しました / Failed to delete");
    } finally {
      setClearDayApplying(false);
    }
  }

  if (!branch) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-500 text-sm text-center">
          不正なリンクです。トップページからやり直してください
          <span className="block text-xs">
            Invalid link — please go back to the top page and try again
          </span>
        </p>
      </main>
    );
  }

  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  // Whether today already has at least one arrival recorded -- 登園確認
  // always starts everyone marked present (the right default the first
  // time it's opened each day), but re-opening it later after some
  // arrivals/absences are already saved would otherwise silently reset
  // the whole day back to "everyone present" if submitted without
  // noticing -- surfaced as a warning rather than changing that default.
  const checkinHasExistingData = students.some(
    (s) => (drafts[`${cellKey(s.studentId, todayStr)}|arrival`] ?? "") !== ""
  );

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{branch} 送迎管理</h1>
          <p className="text-xs text-gray-400">
            {branchToEnglish(branch)} · Pickup/Drop-off Management
          </p>
          <p className="text-sm text-gray-500">
            この支店の全クラスの登園・降園時間をまとめて記録します
            <span className="block text-xs">
              Records arrival/departure times for every class in this branch
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          {isViewingCurrentMonth && students.length > 0 && !showCheckin && (
            <button
              type="button"
              onClick={openCheckin}
              className="rounded-full bg-green-600 text-white px-5 py-2.5 font-semibold text-sm"
            >
              ✅ 登園確認
              <span className="block text-[10px] font-normal opacity-70">Arrival check-in</span>
            </button>
          )}
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
              (window.location.href = `/api/export/pickup?branch=${encodeURIComponent(
                branch
              )}&month=${yearMonth}`)
            }
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="Excelエクスポート / Excel Export"
          >
            📊
          </button>
        </div>
      </div>

      {!showBusSettings && (
        <>
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
        </>
      )}

      {showBusSettings && (
        <div className="flex items-center justify-center gap-4 print:hidden">
          <button
            onClick={goPrevBusTerm}
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
            aria-label="前の学期 / Previous term"
          >
            ◀
          </button>
          <p className="text-lg font-bold w-40 text-center">{busTermLabel}</p>
          <button
            onClick={goNextBusTerm}
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
            aria-label="次の学期 / Next term"
          >
            ▶
          </button>
        </div>
      )}

      {!showCheckin && !showBusSettings && students.length > 0 && (
        <div className="flex items-center justify-center gap-3 flex-wrap print:hidden">
          <button
            onClick={() => setShowBusSettings(true)}
            className="rounded-full border border-purple-400 text-purple-800 bg-purple-50 px-5 py-2 text-sm font-semibold"
          >
            🚌 バス・送迎設定
            <span className="block text-[10px] font-normal opacity-70">
              Bus/pickup settings, by term
            </span>
          </button>
          <button
            onClick={openClearDayModal}
            className="rounded-full border border-red-300 text-red-600 bg-red-50 px-5 py-2 text-sm font-semibold"
          >
            🗑 特定の日を削除
            <span className="block text-[10px] font-normal opacity-70">
              Delete everyone's record for one day
            </span>
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm text-center print:hidden">{error}</p>}

      {!showCheckin && !showBusSettings && loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : !showCheckin && !showBusSettings && students.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          このブランチにはまだ生徒が登録されていません
          <span className="block text-xs">No students registered in this branch yet</span>
        </p>
      ) : showBusSettings ? (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
            <p className="text-sm text-gray-600">
              {busTermLabel} の通学方法（バス・送迎）を月ごとに設定します
              <span className="block text-xs text-gray-400">
                Set each student&apos;s bus/pickup pattern, month by month, for {busTermLabel}
              </span>
            </p>
            <button
              onClick={() => setShowBusSettings(false)}
              className="rounded-full bg-gray-100 text-gray-600 px-4 py-2 text-sm font-semibold shrink-0"
            >
              閉じる / Close
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center print:hidden">
            {busTermMonths[0]}月を変更すると残りの月にも自動反映されます。他の月を変更した場合はその月だけ変わります
            <span className="block">
              Changing {busTermMonths[0]}月 also applies to the rest of the term; changing any
              other month only changes that month
            </span>
          </p>

          {busSettingsLoading ? (
            <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
          ) : (
            <div className="overflow-x-auto border border-gray-300 rounded-xl">
              <table className="text-sm border-collapse min-w-max w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-40">
                      氏名
                      <span className="block text-[9px] font-normal text-gray-400">Name</span>
                    </th>
                    {busTermMonthYears.map((my, i) => (
                      <th
                        key={`${my.year}-${my.month}`}
                        className="border border-gray-300 px-1 py-1 text-center bg-gray-100 w-28"
                      >
                        {my.month}月
                        {i === 0 && (
                          <span className="block text-[9px] font-normal text-gray-400">
                            →他の月に反映
                          </span>
                        )}
                      </th>
                    ))}
                    <th className="border border-gray-300 px-1 py-1 text-center bg-gray-100 w-16">
                      特例
                      <span className="block text-[9px] font-normal text-gray-400">Exception</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let lastClassName: string | null = null;
                    return students.map((s) => {
                      const showGroupHeader = s.className !== lastClassName;
                      lastClassName = s.className;
                      const usesBusAnyMonth = busTermMonthYears.some((my) => {
                        const p = monthPatternFor(s.studentId, my.year, my.month);
                        return p && (p.arrivalMode === "bus" || p.departureMode === "bus");
                      });
                      const hasAddress = !!locationsByStudent[s.studentId];
                      const overrides = busOverridesByStudent[s.studentId] ?? [];
                      const formOpen = overrideFormFor === s.studentId;
                      const extraColCount = busTermMonthYears.length + 2;
                      return (
                        <Fragment key={s.studentId}>
                          {showGroupHeader && (
                            <tr>
                              <td
                                colSpan={extraColCount}
                                className="sticky left-0 bg-blue-50 border border-gray-300 px-3 py-1 font-semibold text-blue-800 text-xs"
                              >
                                {s.className}
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap align-top z-10 leading-tight">
                              <span className="inline-flex items-center gap-1">
                                {s.nameKanji}
                                {usesBusAnyMonth && !hasAddress && (
                                  <span
                                    title="住所が未登録です（生徒管理で登録してください） / No address on file"
                                    className="text-red-600 text-xs"
                                  >
                                    ⚠️
                                  </span>
                                )}
                                {usesBusAnyMonth && hasAddress && (
                                  <span
                                    title={locationsByStudent[s.studentId].address}
                                    className="text-green-700 text-xs"
                                  >
                                    📍
                                  </span>
                                )}
                              </span>
                              {s.nameEnglish && (
                                <span className="block text-[10px] text-gray-400">
                                  {s.nameEnglish}
                                </span>
                              )}
                            </td>
                            {busTermMonthYears.map((my, myIdx) => {
                              const pattern = monthPatternFor(s.studentId, my.year, my.month);
                              const arrivalMode = pattern?.arrivalMode ?? "self";
                              const departureMode = pattern?.departureMode ?? "self";
                              const savingKey = `${s.studentId}|${my.year}-${pad2(my.month)}`;
                              const saving =
                                busPatternSavingId === savingKey ||
                                busPatternSavingId === busTermCascadeKey(s.studentId);
                              return (
                                <td
                                  key={`${my.year}-${my.month}`}
                                  className="border border-gray-300 px-1 py-0.5 text-center"
                                >
                                  <select
                                    value={`${arrivalMode}_${departureMode}`}
                                    disabled={saving}
                                    onChange={(e) => {
                                      const [nextArrival, nextDeparture] = e.target.value.split(
                                        "_"
                                      ) as [BusLegMode, BusLegMode];
                                      if (myIdx === 0) {
                                        setBusPatternForWholeTerm(s, nextArrival, nextDeparture);
                                      } else {
                                        setBusPatternForMonth(
                                          s,
                                          my.year,
                                          my.month,
                                          nextArrival,
                                          nextDeparture
                                        );
                                      }
                                    }}
                                    className="w-full rounded px-0.5 py-1 text-xs border-none bg-transparent text-center disabled:opacity-40"
                                  >
                                    {BUS_MODE_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            })}
                            <td className="border border-gray-300 text-center">
                              <button
                                onClick={() =>
                                  formOpen ? setOverrideFormFor(null) : openOverrideForm(s)
                                }
                                aria-label="特定の日だけ変更 / Override just one day"
                                className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto ${
                                  formOpen || overrides.length > 0
                                    ? "bg-amber-100 text-amber-800"
                                    : "text-gray-400"
                                }`}
                              >
                                ⚡
                              </button>
                            </td>
                          </tr>
                          {(overrides.length > 0 || formOpen) && (
                            <tr>
                              <td
                                colSpan={extraColCount}
                                className="border border-gray-300 bg-amber-50 px-3 py-2"
                              >
                                <div className="flex flex-col gap-2">
                                  {overrides.length > 0 && (
                                    <ul className="flex flex-wrap gap-1.5">
                                      {overrides.map((o) => {
                                        const optKey = `${o.arrivalMode}_${o.departureMode}`;
                                        const optLabel =
                                          BUS_MODE_OPTIONS.find((x) => x.value === optKey)?.label ??
                                          optKey;
                                        const savingThis =
                                          overrideSavingKey === `${s.studentId}|${o.date}`;
                                        return (
                                          <li
                                            key={o.date}
                                            className="flex items-center gap-1 text-[11px] bg-white border border-amber-300 text-amber-800 rounded-full pl-2.5 pr-1 py-0.5"
                                          >
                                            {o.date.slice(5).replace("-", "/")}: {optLabel}
                                            <button
                                              onClick={() => removeOverride(s.studentId, o.date)}
                                              disabled={savingThis}
                                              aria-label="この特例を削除 / Remove this exception"
                                              className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-amber-200 disabled:opacity-40"
                                            >
                                              ×
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                  {formOpen && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <input
                                        type="date"
                                        value={overrideDate}
                                        min={busTermStartDate}
                                        max={busTermEndDate}
                                        onChange={(e) => {
                                          setOverrideDate(e.target.value);
                                          setOverrideModeForDate(s, e.target.value);
                                        }}
                                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white"
                                      />
                                      <select
                                        value={overrideMode}
                                        onChange={(e) => setOverrideMode(e.target.value)}
                                        className="rounded-full px-2.5 py-1 text-xs font-semibold border bg-white text-gray-600 border-gray-300"
                                      >
                                        {BUS_MODE_OPTIONS.map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.label}
                                          </option>
                                        ))}
                                      </select>
                                      {(() => {
                                        const dow = overrideDate
                                          ? new Date(overrideDate + "T00:00:00").getDay()
                                          : -1;
                                        const isWeekend = dow === 0 || dow === 6;
                                        return (
                                          <>
                                            {isWeekend && (
                                              <span className="text-[11px] text-red-600">
                                                土日は選べません / Weekends have no school
                                              </span>
                                            )}
                                            <button
                                              onClick={() => saveOverride(s)}
                                              disabled={
                                                !overrideDate ||
                                                isWeekend ||
                                                overrideSavingKey === `${s.studentId}|${overrideDate}`
                                              }
                                              className="rounded-full bg-amber-600 text-white px-3 py-1 text-xs font-semibold disabled:opacity-40"
                                            >
                                              保存 / Save
                                            </button>
                                          </>
                                        );
                                      })()}
                                      <button
                                        onClick={() => setOverrideFormFor(null)}
                                        className="rounded-full bg-gray-100 text-gray-600 px-3 py-1 text-xs font-semibold"
                                      >
                                        キャンセル / Cancel
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : showCheckin ? (
        <>
          <p className="text-sm text-gray-600 print:hidden">
            全員デフォルトで登園済みです。お休みの生徒だけタップしてください
            <span className="block text-xs text-gray-400">
              Everyone starts marked arrived — tap only the students who are absent today
            </span>
          </p>

          {checkinHasExistingData && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-4 py-2 print:hidden">
              ⚠️ 本日はすでに登園記録があります。このまま送信すると、記録済みのお休みも「登園」で上書きされます
              <span className="block text-xs opacity-80">
                Today already has arrival data saved — submitting now will overwrite any recorded
                absences back to &quot;arrived&quot; too
              </span>
            </p>
          )}

          {(() => {
            // Grouped 年少/年中/年長, left-to-right in that order (any
            // other class, e.g. 小学生, is grouped separately and appended
            // after) -- so which class a student is in is clear from
            // which section their card sits in, not just a flat list.
            const GRADE_GROUPS: {
              suffix: string;
              ja: string;
              en: string;
              box: string;
              header: string;
            }[] = [
              {
                suffix: "年少",
                ja: "年少",
                en: "Younger Class",
                box: "border-amber-300 bg-amber-50/40",
                header: "text-amber-800 border-amber-300",
              },
              {
                suffix: "年中",
                ja: "年中",
                en: "Middle Class",
                box: "border-sky-300 bg-sky-50/40",
                header: "text-sky-800 border-sky-300",
              },
              {
                suffix: "年長",
                ja: "年長",
                en: "Older Class",
                box: "border-emerald-300 bg-emerald-50/40",
                header: "text-emerald-800 border-emerald-300",
              },
            ];
            const groups = GRADE_GROUPS.map((g) => ({
              ...g,
              list: students.filter((s) => s.className.endsWith(g.suffix)),
            }));
            const grouped = new Set(groups.flatMap((g) => g.list.map((s) => s.studentId)));
            const others = students.filter((s) => !grouped.has(s.studentId));
            if (others.length > 0) {
              groups.push({
                suffix: "",
                ja: "その他",
                en: "Other",
                box: "border-gray-300 bg-gray-50/40",
                header: "text-gray-700 border-gray-300",
                list: others,
              });
            }

            let runningIndex = 0;
            return (
              <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-5 print:hidden">
                {groups.map((group) => (
                  <div
                    key={group.ja}
                    className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${group.box}`}
                  >
                    <h3 className={`text-sm font-bold border-b pb-1 ${group.header}`}>
                      {group.ja}
                      <span className="ml-2 text-xs font-normal opacity-60">{group.en}</span>
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {group.list.map((s) => {
                        const isAbsent = checkinAbsent.has(s.studentId);
                        runningIndex += 1;
                        const num = runningIndex;
                        return (
                          <button
                            key={s.studentId}
                            onClick={() => toggleCheckinCard(s.studentId)}
                            className={`relative rounded-xl border-2 px-3 py-6 text-center font-medium transition ${
                              isAbsent
                                ? "bg-red-50 border-red-500 text-red-800"
                                : "bg-green-50 border-green-400 text-green-800"
                            }`}
                          >
                            <span className="absolute top-1 left-2 text-xs font-normal text-gray-400">
                              {num}
                            </span>
                            <span className="block">{s.nameKanji}</span>
                            {s.nameEnglish && (
                              <span className="block text-[10px] font-normal opacity-70">
                                {s.nameEnglish}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="flex items-center justify-between border-t pt-4 print:hidden">
            <p className="text-sm">
              登園: <span className="font-bold">{students.length - checkinAbsent.size}</span> /
              お休み: <span className="font-bold">{checkinAbsent.size}</span>
              <span className="block text-xs text-gray-400">
                Arrived: {students.length - checkinAbsent.size} / Absent: {checkinAbsent.size}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCheckin(false)}
                disabled={checkinSubmitting}
                className="rounded-full bg-gray-100 text-gray-600 px-6 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル
                <span className="block text-[10px] font-normal opacity-70">Cancel</span>
              </button>
              <button
                onClick={() => setShowCheckinConfirm(true)}
                disabled={checkinSubmitting}
                className="rounded-full bg-green-600 text-white px-6 py-3 font-semibold disabled:opacity-40"
              >
                確定する
                <span className="block text-[10px] font-normal opacity-70">Confirm</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto border border-gray-300 rounded-xl">
          <table className="text-sm border-collapse min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-gray-100 border border-gray-300 px-3 py-1 text-left whitespace-nowrap z-10 w-28">
                  氏名
                  <span className="block text-[9px] font-normal text-gray-400">Name</span>
                </th>
                <th className="sticky left-28 bg-gray-100 border border-gray-300 px-1 py-1 text-center whitespace-nowrap z-10 w-11">
                  —
                </th>
                {dayNumbers.map((day) => {
                  const dow = new Date(year, month - 1, day).getDay();
                  return (
                    <th
                      key={day}
                      className={`border border-gray-300 px-0.5 py-1 text-center w-10 ${weekendHeaderClasses(dow)}`}
                    >
                      <div>{day}</div>
                      <div className="text-[10px] font-normal">{WEEKDAY_LABELS[dow]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(() => {
                let lastClassName: string | null = null;
                return students.map((s) => {
                  const showGroupHeader = s.className !== lastClassName;
                  lastClassName = s.className;

                  return (
                    <Fragment key={s.studentId}>
                      {showGroupHeader && (
                        <tr>
                          <td
                            colSpan={dayNumbers.length + 2}
                            className="sticky left-0 bg-blue-50 border border-gray-300 px-3 py-1 font-semibold text-blue-800 text-xs"
                          >
                            {s.className}
                          </td>
                        </tr>
                      )}
                      {(["arrival", "departure"] as const).map((field, fi) => (
                        <tr key={field}>
                          {fi === 0 && (
                            <td
                              rowSpan={2}
                              className="sticky left-0 bg-white border border-gray-300 px-3 py-1 whitespace-nowrap align-top z-10 leading-tight"
                            >
                              {s.nameKanji}
                              {s.nameEnglish && (
                                <span className="block text-[10px] text-gray-400">
                                  {s.nameEnglish}
                                </span>
                              )}
                            </td>
                          )}
                          <td
                            className={`sticky left-28 border border-gray-300 px-1 py-1 text-center whitespace-nowrap text-xs text-gray-500 z-10 ${
                              field === "departure" ? "bg-orange-50" : "bg-white"
                            }`}
                          >
                            {field === "arrival" ? "登園" : "降園"}
                          </td>
                          {dayNumbers.map((day) => {
                            const date = `${year}-${pad2(month)}-${pad2(day)}`;
                            const dow = new Date(year, month - 1, day).getDay();
                            const isWeekend = dow === 0 || dow === 6;
                            const draftKey = `${cellKey(s.studentId, date)}|${field}`;
                            const isSaving = savingKey === draftKey;
                            const isChecked = (drafts[draftKey] ?? "") !== "";
                            return (
                              <td
                                key={day}
                                onClick={() =>
                                  !isSaving && !isWeekend && toggleCheck(s.studentId, date, field)
                                }
                                className={`text-center border border-gray-300 py-1 select-none ${
                                  isWeekend
                                    ? "cursor-default"
                                    : isSaving
                                      ? "opacity-40 cursor-wait"
                                      : "cursor-pointer"
                                } ${cellBgClass(dow, field)}`}
                              >
                                <div className="w-6 h-6 mx-auto flex items-center justify-center">
                                  {isWeekend ? null : isChecked ? (
                                    <span className="w-6 h-6 rounded-full border-[3px] border-red-600" />
                                  ) : (
                                    <span className="text-gray-300 text-base leading-none">—</span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {showCheckinConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h2 className="text-lg font-bold text-center">
              本日の登園確認
              <span className="block text-sm font-normal text-gray-500">
                Today&apos;s arrival check-in
              </span>
            </h2>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-3xl font-bold text-green-700">
                  {students.length - checkinAbsent.size}
                </p>
                <p className="text-sm text-gray-500">
                  登園
                  <span className="block text-xs">Arrived</span>
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{checkinAbsent.size}</p>
                <p className="text-sm text-gray-500">
                  お休み
                  <span className="block text-xs">Absent</span>
                </p>
              </div>
            </div>
            {checkinAbsent.size > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1">お休みの生徒: / Absent students:</p>
                <ul className="flex flex-wrap gap-2">
                  {students
                    .filter((s) => checkinAbsent.has(s.studentId))
                    .map((s) => (
                      <li
                        key={s.studentId}
                        className="text-xs bg-red-50 text-red-700 rounded-full px-3 py-1"
                      >
                        {s.nameEnglish || s.nameKanji}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {checkinHasExistingData && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-center">
                ⚠️ 本日の記録を全て上書きします。お休みのはずの生徒が漏れていないか確認してください
                <span className="block opacity-80">
                  This overwrites today&apos;s existing record entirely — double-check no one
                  who&apos;s actually absent is missing above
                </span>
              </p>
            )}
            <p className="text-xs text-gray-400 text-center">
              この内容で記録します。よろしいですか？
              <span className="block">Record with this content — is that OK?</span>
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => setShowCheckinConfirm(false)}
                disabled={checkinSubmitting}
                className="flex-1 rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={submitCheckin}
                disabled={checkinSubmitting}
                className="flex-1 rounded-full bg-green-600 text-white py-3 font-semibold disabled:opacity-40"
              >
                {checkinSubmitting ? "送信中... / Sending..." : "送信する / Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearDayModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !clearDayApplying && setShowClearDayModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {clearDayDone !== null ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  削除しました
                  <span className="block text-sm font-normal text-gray-500">Deleted</span>
                </h2>
                <p className="text-sm text-center text-gray-600">
                  {clearDayDate} の記録 {clearDayDone}件を削除しました
                  <span className="block text-xs">
                    Removed {clearDayDone} record(s) for {clearDayDate}
                  </span>
                </p>
                <button
                  onClick={() => setShowClearDayModal(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  特定の日を削除
                  <span className="block text-sm font-normal text-gray-500">
                    Delete a specific day
                  </span>
                </h2>
                <label className="flex flex-col gap-1 text-sm">
                  日付
                  <span className="text-xs font-normal text-gray-500">Date</span>
                  <input
                    type="date"
                    value={clearDayDate}
                    min={`${yearMonth}-01`}
                    max={`${yearMonth}-${pad2(daysInMonth(year, month))}`}
                    disabled={clearDayFinalStep}
                    onChange={(e) => {
                      setClearDayDate(e.target.value);
                      setClearDayFinalStep(false); // re-confirm against the new date's count
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 disabled:opacity-60"
                  />
                </label>
                {(() => {
                  const affected = pickupCountForDate(clearDayDate);
                  return (
                    <div
                      className={`rounded-xl p-4 text-center ${
                        affected > 0 ? "bg-red-50 border border-red-300" : "bg-gray-50"
                      }`}
                    >
                      <p
                        className={`text-2xl font-bold ${
                          affected > 0 ? "text-red-600" : "text-gray-400"
                        }`}
                      >
                        {affected}
                      </p>
                      <p className="text-xs text-gray-500">
                        {clearDayDate} の記録件数
                        <span className="block text-[10px] text-gray-400">
                          Records for {clearDayDate}
                        </span>
                      </p>
                    </div>
                  );
                })()}

                {!clearDayFinalStep ? (
                  <>
                    <p className="text-xs text-gray-400 text-center">
                      {branch} の {clearDayDate}
                      の送迎記録を全員分削除します。空欄（未確認）の状態に戻ります。よろしいですか？
                      <span className="block">
                        Deletes every student&apos;s 登園/降園 record for {branch} on{" "}
                        {clearDayDate}, back to blank (not checked). Continue?
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowClearDayModal(false)}
                        className="rounded-full bg-gray-100 text-gray-600 py-3 font-semibold"
                      >
                        キャンセル / Cancel
                      </button>
                      <button
                        onClick={() => setClearDayFinalStep(true)}
                        disabled={pickupCountForDate(clearDayDate) === 0}
                        className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                      >
                        次へ / Next
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                      <p className="text-sm text-red-800 font-semibold text-center">
                        ⚠ この削除は完全に永久的です。バックアップはなく、二度と復元できません
                        <span className="block text-xs font-normal mt-1">
                          This deletion is permanent — there is no backup and it can never be
                          recovered.
                        </span>
                      </p>
                    </div>
                    {clearDayError && (
                      <p className="text-red-600 text-sm text-center">{clearDayError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setClearDayFinalStep(false)}
                        disabled={clearDayApplying}
                        className="rounded-full bg-gray-100 text-gray-600 py-3 font-semibold disabled:opacity-40"
                      >
                        戻る / Back
                      </button>
                      <button
                        onClick={handleClearDay}
                        disabled={clearDayApplying}
                        className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                      >
                        {clearDayApplying ? "削除中... / Deleting..." : "本当に削除する / Really delete"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function PickupPage() {
  return (
    <Suspense fallback={null}>
      <PickupPageInner />
    </Suspense>
  );
}
