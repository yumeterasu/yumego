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

function headerRowStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
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
  }
) {
  const { sheetName, yearMonth, students, records, checkLabels } = opts;
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
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });

  const checkHeaders = [
    checkLabels.check1Label || "チェック1",
    checkLabels.check2Label || "チェック2",
    checkLabels.check3Label || "チェック3",
  ];

  const headerRowValues = [
    "#",
    "名前",
    ...dayNumbers.map((d) => `${d}(${WEEKDAY_LABELS[new Date(year, month - 1, d).getDay()]})`),
    "出",
    "欠",
    "欠席理由",
    ...checkHeaders,
    "備考",
  ];
  const headerRow = sheet.addRow(headerRowValues);
  headerRowStyle(headerRow);
  headerRow.eachCell((cell, colNumber) => {
    // day columns start at index 3 (1-based colNumber 3..3+numDays-1)
    const dayIdx = colNumber - 3;
    if (dayIdx >= 0 && dayIdx < dayNumbers.length) {
      const day = dayNumbers[dayIdx];
      const dow = new Date(year, month - 1, day).getDay();
      if (dow === 0 || dow === 6) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0DC" } };
        cell.font = { bold: true, color: { argb: "FFC2410C" } };
      }
    }
  });

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

    const reasonCounts = new Map<string, number>();
    for (const reason of reasonMap.values()) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const reasonSummary = Array.from(reasonCounts.entries())
      .map(([reason, count]) => `${reason} ${count}`)
      .join(", ");

    const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;

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
      s.check1 ? "✓" : "",
      s.check2 ? "✓" : "",
      s.check3 ? "✓" : "",
      s.remark ?? "",
    ];
    const row = sheet.addRow(rowValues);
    row.getCell(2).alignment = { wrapText: true, vertical: "middle" };

    dayNumbers.forEach((day, idx) => {
      const status = dayMap.get(day);
      const cell = row.getCell(3 + idx);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (status) {
        cell.font = { bold: true, color: { argb: STATUS_COLOR[status] } };
      }
      const dow = new Date(year, month - 1, day).getDay();
      if ((dow === 0 || dow === 6) && !status) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
      }
    });
  });

  sheet.columns = [
    { width: 4 },
    { width: 20 },
    ...dayNumbers.map(() => ({ width: 5 })),
    { width: 5 },
    { width: 5 },
    { width: 20 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 24 },
  ];

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
  }
) {
  const { sheetName, fiscalYearStart, students, records } = opts;

  const countsAsPresent = (status: AttendanceStatus) =>
    status === "present" || status === "late" || status === "early_leave";

  const counts = new Map<string, number[]>();
  for (const s of students) counts.set(s.studentId, new Array(12).fill(0));

  for (const r of records) {
    if (!countsAsPresent(r.status)) continue;
    const y = Number(r.date.slice(0, 4));
    const m = Number(r.date.slice(5, 7));
    const monthIndex = FISCAL_MONTHS.findIndex(
      (fm) => fm.monthNum === m && fiscalYearStart + fm.yearOffset === y
    );
    if (monthIndex === -1) continue;
    const arr = counts.get(r.studentId);
    if (arr) arr[monthIndex]++;
  }

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });

  const headerRow = sheet.addRow([
    "名前",
    ...FISCAL_MONTHS.map((fm, idx) => `${fm.monthNum}月(${MONTH_EN[idx]})`),
    "出席日数",
    "備考",
  ]);
  headerRowStyle(headerRow);

  students.forEach((s) => {
    const monthCounts = counts.get(s.studentId) ?? new Array(12).fill(0);
    const total = monthCounts.reduce((a, b) => a + b, 0);
    const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;

    const row = sheet.addRow([nameCell, ...monthCounts.map((c) => (c > 0 ? c : "")), total, s.remark ?? ""]);
    row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
    row.eachCell((cell, colNumber) => {
      if (colNumber >= 2 && colNumber <= 13) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
    const totalCell = row.getCell(14);
    totalCell.font = { bold: true, color: { argb: "FF16A34A" } };
    totalCell.alignment = { horizontal: "center", vertical: "middle" };
  });

  sheet.columns = [
    { width: 20 },
    ...FISCAL_MONTHS.map(() => ({ width: 9 })),
    { width: 10 },
    { width: 24 },
  ];

  return sheet;
}

/** "2026-08" -> fiscal year start (2026, since Apr-Dec belongs to that year's fiscal year; Jan-Mar belongs to the previous). */
export function yearMonthToFiscalYearStart(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}
