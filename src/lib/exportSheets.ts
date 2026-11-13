// Shared ExcelJS sheet-builders for the monthly/annual Dashboard exports —
// factored out so the standalone /api/export/monthly and /api/export/annual
// routes and the end-of-term Reset backup (/api/export/reset-backup) all
// produce identically-formatted sheets instead of three copies of the same
// layout logic drifting apart over time.
import ExcelJS from "exceljs";
import type { AttendanceStatus, ClassCheckLabels, Student } from "@/lib/sheets";

export type AttendanceRow = {
  date: string;
  studentId: string;
  status: AttendanceStatus;
  reason: string;
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// This file runs server-side, so there's no browser-local Date() to rely on
// for "today" the way the Dashboard's own todayDateString() does -- same
// Bangkok-shift idiom already used in src/lib/reportSheets.ts.
function todayBangkok(): string {
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** Count of school days between start and end ("YYYY-MM-DD", inclusive) --
 *  skips Saturdays, Sundays, and any date in closedDates (merged Master
 *  holidays + this class's own calendar overrides). Used for 登園日数. */
function countSchoolDays(start: string, end: string, closedDates: Set<string>): number {
  let count = 0;
  const cur = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cur <= last) {
    const dow = cur.getDay();
    const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
      cur.getDate()
    ).padStart(2, "0")}`;
    if (dow !== 0 && dow !== 6 && !closedDates.has(dateStr)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出",
  absent: "欠",
  late: "遅",
  early_leave: "早",
  suspended: "出停",
};

// ARGB hex, matches the on-screen status colors (and the app's brand green).
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: "FF16A34A",
  absent: "FFDC2626",
  late: "FFD97706",
  early_leave: "FF2563EB",
  suspended: "FF7E22CE",
};

// Matches the operator's own reference Google Sheet (名前(NAME)/Kosugi,
// size 10) as closely as ExcelJS allows -- see addMonthlySheet.
const BASE_FONT = { name: "Kosugi", size: 10 };

function headerRowStyle(row: ExcelJS.Row) {
  row.font = { ...BASE_FONT, bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB0B0B0" } },
  left: { style: "thin", color: { argb: "FFB0B0B0" } },
  bottom: { style: "thin", color: { argb: "FFB0B0B0" } },
  right: { style: "thin", color: { argb: "FFB0B0B0" } },
};

/**
 * Draws a thin grid border around every cell in the sheet's used rectangle
 * (row 1..rowCount, column 1..totalCols) — without this, ExcelJS sheets
 * have no borders at all, so a printed page just shows floating text with
 * no cell lines. Called once after a sheet's rows are fully built.
 */
export function applyGridBorders(sheet: ExcelJS.Worksheet, totalCols: number) {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= totalCols; c++) {
      row.getCell(c).border = THIN_BORDER;
    }
  }
}

/**
 * One month's day-by-day grid, exactly like the Dashboard's own 📊 Excel
 * export: one row per student, one column per day, 出/欠 totals, reason
 * summary, this class's custom チェック1/2/3 labels, and 備考.
 */
export function addMonthlySheet(
  workbook: ExcelJS.Workbook,
  opts: {
    sheetName: string;
    yearMonth: string; // "2026-08"
    students: Student[];
    records: AttendanceRow[];
    checkLabels: ClassCheckLabels;
    // studentId -> this month's check1/2/3 — チェック1/2/3 are scoped per
    // class+month now, not a permanent property of the student, so this
    // must be looked up for the specific month being exported.
    monthlyChecks?: Map<string, { check1: boolean; check2: boolean; check3: boolean }>;
    // Merged Master holidays + this class's own calendar overrides, as
    // "YYYY-MM-DD" strings -- see countSchoolDays, used for 登園日数. Not
    // month-scoped by the caller (both sources are whole-list fetches), so
    // the same Set can be reused across multiple addMonthlySheet calls.
    closedDates: Set<string>;
  }
) {
  const { sheetName, yearMonth, students, records, checkLabels, monthlyChecks, closedDates } = opts;
  const [year, month] = yearMonth.split("-").map(Number);
  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  // studentId -> day -> status/reason, deduped by day (a Map.set with the
  // same key naturally collapses stray duplicate rows to one, matching
  // what the Dashboard itself shows).
  const statusByStudentDay = new Map<string, Map<number, AttendanceStatus>>();
  const reasonByStudentDay = new Map<string, Map<number, string>>();
  for (const r of records) {
    const day = Number(r.date.slice(8, 10));
    if (!statusByStudentDay.has(r.studentId)) statusByStudentDay.set(r.studentId, new Map());
    statusByStudentDay.get(r.studentId)!.set(day, r.status);
    if (r.reason) {
      if (!reasonByStudentDay.has(r.studentId)) reasonByStudentDay.set(r.studentId, new Map());
      reasonByStudentDay.get(r.studentId)!.set(day, r.reason);
    }
  }

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });

  const checkHeaders = [
    checkLabels.check1Label || "チェック1",
    checkLabels.check2Label || "チェック2",
    checkLabels.check3Label || "チェック3",
  ];

  // Two-row date header (day number over weekday), matching the reference
  // Google Sheet -- narrow date columns only read cleanly split this way;
  // the non-date columns (#, 名前, 出, 欠, ...) are vertically merged across
  // both rows below so their labels still read as a single header cell.
  const totalCols = numDays + 10;
  const headerRow1Values = [
    "#",
    "名前",
    ...dayNumbers.map((d) => String(d).padStart(2, "0")),
    "出",
    "欠",
    "欠席理由",
    "登園日数",
    ...checkHeaders,
    "備考",
  ];
  const headerRow2Values = [
    "",
    "",
    ...dayNumbers.map((d) => WEEKDAY_LABELS[new Date(year, month - 1, d).getDay()]),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
  const headerRow1 = sheet.addRow(headerRow1Values);
  const headerRow2 = sheet.addRow(headerRow2Values);
  headerRowStyle(headerRow1);
  headerRowStyle(headerRow2);

  [headerRow1, headerRow2].forEach((hRow) => {
    hRow.eachCell((cell, colNumber) => {
      // day columns start at index 3 (1-based colNumber 3..3+numDays-1)
      const dayIdx = colNumber - 3;
      if (dayIdx >= 0 && dayIdx < dayNumbers.length) {
        const day = dayNumbers[dayIdx];
        const dow = new Date(year, month - 1, day).getDay();
        if (dow === 0 || dow === 6) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0DC" } };
          cell.font = { ...BASE_FONT, bold: true, color: { argb: "FFC2410C" } };
        }
      }
    });
  });

  // #, 名前, 出, 欠, 欠席理由, チェック1-3, 備考 -- every non-date column --
  // span both header rows as one merged cell.
  const nonDateCols = [
    1,
    2,
    3 + numDays,
    4 + numDays,
    5 + numDays,
    6 + numDays,
    7 + numDays,
    8 + numDays,
    9 + numDays,
    10 + numDays,
  ];
  for (const col of nonDateCols) {
    sheet.mergeCells(headerRow1.number, col, headerRow2.number, col);
  }

  const countsAsPresent = (status: AttendanceStatus) =>
    status === "present" || status === "late" || status === "early_leave";

  students.forEach((s, i) => {
    const dayMap = statusByStudentDay.get(s.studentId) ?? new Map<number, AttendanceStatus>();
    const reasonMap = reasonByStudentDay.get(s.studentId) ?? new Map<number, string>();

    let presentCount = 0;
    let absentCount = 0;
    for (const status of dayMap.values()) {
      if (countsAsPresent(status)) presentCount++;
      else absentCount++;
    }

    // 登園日数 -- see countSchoolDays/todayBangkok above. Mirrors the
    // Dashboard's own on-screen computation exactly (weekends and
    // closedDates excluded, not just a raw calendar-day span).
    let effectiveStart = s.startDate;
    if (!effectiveStart && dayMap.size > 0) {
      const earliestDay = Math.min(...dayMap.keys());
      effectiveStart = `${year}-${String(month).padStart(2, "0")}-${String(earliestDay).padStart(2, "0")}`;
    }
    let enrolledDays: number | null = null;
    if (effectiveStart) {
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(numDays).padStart(2, "0")}`;
      const today = todayBangkok();
      const rangeStart = effectiveStart > monthStart ? effectiveStart : monthStart;
      let rangeEnd = today < monthEnd ? today : monthEnd;
      if (s.endDate && s.endDate < rangeEnd) rangeEnd = s.endDate;
      enrolledDays = rangeStart <= rangeEnd ? countSchoolDays(rangeStart, rangeEnd, closedDates) : 0;
    }

    const reasonCounts = new Map<string, number>();
    for (const reason of reasonMap.values()) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const reasonSummary = Array.from(reasonCounts.entries())
      .map(([reason, count]) => `${reason} ${count}`)
      .join(", ");

    const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;
    const check = monthlyChecks?.get(s.studentId);

    const rowValues = [
      i + 1,
      nameCell,
      ...dayNumbers.map((day) => {
        const status = dayMap.get(day);
        return status ? STATUS_LABEL[status] : "";
      }),
      presentCount || "",
      absentCount || "",
      reasonSummary,
      enrolledDays !== null ? enrolledDays : "",
      check?.check1 ? "✓" : "",
      check?.check2 ? "✓" : "",
      check?.check3 ? "✓" : "",
      s.remark ?? "",
    ];
    const row = sheet.addRow(rowValues);
    row.font = BASE_FONT;
    row.getCell(2).alignment = { wrapText: true, vertical: "middle" };

    dayNumbers.forEach((day, idx) => {
      const status = dayMap.get(day);
      const cell = row.getCell(3 + idx);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      const dow = new Date(year, month - 1, day).getDay();
      // Weekend columns are tinted top-to-bottom regardless of whether a
      // status was entered -- matches the reference sheet's continuous
      // column shading, not just a blank-cell highlight.
      if (dow === 0 || dow === 6) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
      }
      cell.font = status
        ? { ...BASE_FONT, bold: true, color: { argb: STATUS_COLOR[status] } }
        : BASE_FONT;
    });
  });

  sheet.columns = [
    { width: 4 },
    { width: 20 },
    // Narrow, matching the reference sheet's compact date columns -- safe
    // now that the day number and weekday are on their own header rows
    // instead of sharing one cell (see the "31(土)" wrapping fix history).
    ...dayNumbers.map(() => ({ width: 3.5 })),
    { width: 5 },
    { width: 5 },
    { width: 20 },
    { width: 8 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 24 },
  ];

  applyGridBorders(sheet, totalCols);

  return sheet;
}

const MONTH_EN = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
];
const FISCAL_MONTHS: { monthNum: number; yearOffset: 0 | 1 }[] = [
  { monthNum: 4, yearOffset: 0 },
  { monthNum: 5, yearOffset: 0 },
  { monthNum: 6, yearOffset: 0 },
  { monthNum: 7, yearOffset: 0 },
  { monthNum: 8, yearOffset: 0 },
  { monthNum: 9, yearOffset: 0 },
  { monthNum: 10, yearOffset: 0 },
  { monthNum: 11, yearOffset: 0 },
  { monthNum: 12, yearOffset: 0 },
  { monthNum: 1, yearOffset: 1 },
  { monthNum: 2, yearOffset: 1 },
  { monthNum: 3, yearOffset: 1 },
];

/**
 * One fiscal year's (Apr-Mar) present-days-per-month summary, exactly like
 * the Annual Summary page's own 📊 Excel export.
 */
export function addAnnualSheet(
  workbook: ExcelJS.Workbook,
  opts: {
    sheetName: string;
    fiscalYearStart: number;
    students: Student[];
    records: AttendanceRow[];
    // Merged Master holidays + this class's own calendar overrides, as
    // "YYYY-MM-DD" strings -- see countSchoolDays, used for the 登園日数
    // total (sum of each fiscal month's school-day-enrolled count).
    closedDates: Set<string>;
  }
) {
  const { sheetName, fiscalYearStart, students, records, closedDates } = opts;

  const countsAsPresent = (status: AttendanceStatus) =>
    status === "present" || status === "late" || status === "early_leave";

  const counts = new Map<string, number[]>();
  for (const s of students) counts.set(s.studentId, new Array(12).fill(0));

  // studentId -> monthIndex -> earliest recorded date that month (any
  // status), for the same startDate-not-set fallback addMonthlySheet uses.
  const earliestRecordByStudentMonth = new Map<string, Map<number, string>>();

  for (const r of records) {
    const y = Number(r.date.slice(0, 4));
    const m = Number(r.date.slice(5, 7));
    const monthIndex = FISCAL_MONTHS.findIndex(
      (fm) => fm.monthNum === m && fiscalYearStart + fm.yearOffset === y
    );
    if (monthIndex === -1) continue;

    if (countsAsPresent(r.status)) {
      const arr = counts.get(r.studentId);
      if (arr) arr[monthIndex]++;
    }

    if (!earliestRecordByStudentMonth.has(r.studentId)) {
      earliestRecordByStudentMonth.set(r.studentId, new Map());
    }
    const monthMap = earliestRecordByStudentMonth.get(r.studentId)!;
    const existing = monthMap.get(monthIndex);
    if (!existing || r.date < existing) monthMap.set(monthIndex, r.date);
  }

  // 登園日数 total -- walks each fiscal month separately (same per-month
  // clamping/fallback as addMonthlySheet's single-month version above) and
  // sums the 12 results, since there's no shortcut that avoids repeating
  // the clamp logic once per month.
  const today = todayBangkok();
  const enrolledTotalByStudent = new Map<string, number>();
  for (const s of students) {
    let total = 0;
    for (let monthIndex = 0; monthIndex < FISCAL_MONTHS.length; monthIndex++) {
      const { monthNum, yearOffset } = FISCAL_MONTHS[monthIndex];
      const y = fiscalYearStart + yearOffset;
      const monthStart = `${y}-${String(monthNum).padStart(2, "0")}-01`;
      const monthEnd = `${y}-${String(monthNum).padStart(2, "0")}-${String(
        daysInMonth(y, monthNum)
      ).padStart(2, "0")}`;

      let effectiveStart: string | undefined = s.startDate;
      if (!effectiveStart) {
        effectiveStart = earliestRecordByStudentMonth.get(s.studentId)?.get(monthIndex);
      }
      if (!effectiveStart) continue;

      const rangeStart = effectiveStart > monthStart ? effectiveStart : monthStart;
      let rangeEnd = today < monthEnd ? today : monthEnd;
      if (s.endDate && s.endDate < rangeEnd) rangeEnd = s.endDate;
      if (rangeStart <= rangeEnd) total += countSchoolDays(rangeStart, rangeEnd, closedDates);
    }
    enrolledTotalByStudent.set(s.studentId, total);
  }

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });

  const headerRow = sheet.addRow([
    "名前",
    ...FISCAL_MONTHS.map((fm, idx) => `${fm.monthNum}月(${MONTH_EN[idx]})`),
    "出席日数",
    "登園日数",
    "備考",
  ]);
  headerRowStyle(headerRow);

  students.forEach((s) => {
    const monthCounts = counts.get(s.studentId) ?? new Array(12).fill(0);
    const total = monthCounts.reduce((a, b) => a + b, 0);
    const enrolledTotal = enrolledTotalByStudent.get(s.studentId) ?? 0;
    const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;

    const row = sheet.addRow([
      nameCell,
      ...monthCounts.map((c) => (c > 0 ? c : "")),
      total,
      enrolledTotal || "",
      s.remark ?? "",
    ]);
    row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
    row.eachCell((cell, colNumber) => {
      if (colNumber >= 2 && colNumber <= 13) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
    const totalCell = row.getCell(14);
    totalCell.font = { bold: true, color: { argb: "FF16A34A" } };
    totalCell.alignment = { horizontal: "center", vertical: "middle" };
    const enrolledCell = row.getCell(15);
    enrolledCell.font = { bold: true, color: { argb: "FF1D4ED8" } };
    enrolledCell.alignment = { horizontal: "center", vertical: "middle" };
  });

  sheet.columns = [
    { width: 20 },
    ...FISCAL_MONTHS.map(() => ({ width: 10 })), // margin for "12月(Dec)" etc. without wrapping
    { width: 10 },
    { width: 10 },
    { width: 24 },
  ];

  applyGridBorders(sheet, 4 + FISCAL_MONTHS.length);

  return sheet;
}

/** "2026-08" -> fiscal year start (2026, since Apr-Dec belongs to that year's fiscal year; Jan-Mar belongs to the previous). */
export function yearMonthToFiscalYearStart(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}
