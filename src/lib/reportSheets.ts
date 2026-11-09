// Rebuilds a separate, read-only "report" Google Sheet (one tab per class,
// styled to match the Dashboard's own 📊 Excel export as closely as the
// Sheets API allows) from the live attendance data. Unlike exportSheets.ts
// (which builds an ExcelJS workbook for a one-time .xlsx download), this
// writes directly into an existing Google Sheet via the Sheets API's
// batchUpdate, so a human can just leave that Sheet open and see it refresh
// periodically — see src/app/api/cron/report-sync/route.ts for the trigger.
//
// Every run fully deletes + recreates each class's tab rather than editing
// it in place: the day-range grows by one column every day, so "clear and
// reposition everything" is far simpler and more robust than tracking how
// every merge/column index shifts from one run to the next, and it
// guarantees no leftover manual edit (a stray filter, a note, a protected
// range) survives into the next sync.
import type { sheets_v4 } from "googleapis";
import {
  getSheetsClient,
  getStudentsByClass,
  getAllAttendanceForClass,
  getClassCheckLabels,
  getMonthlyChecks,
  getExtraClasses,
  type Student,
  type AttendanceStatus,
} from "@/lib/sheets";
import { CLASSES } from "@/lib/classes";

const REPORT_SHEET_ID = process.env.REPORT_SHEET_ID!;

// Literal, as requested -- not auto-rolling. Left running unchanged for
// multiple school years this grows without bound (more columns every day,
// forever), which is fine for this year (~340 columns by next August) but
// not something to leave on autopilot indefinitely. If that's ever a
// problem, swap this for "the most recent Sept 1 on/before today" instead
// of a literal date -- caps the lifetime width at one school year, forever.
const REPORT_START_DATE = "2026-09-01";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出",
  absent: "欠",
  late: "遅",
  early_leave: "早",
  suspended: "出停",
};

// Same hex values as exportSheets.ts's STATUS_COLOR, for visual parity.
const STATUS_COLOR_HEX: Record<AttendanceStatus, string> = {
  present: "16A34A",
  absent: "DC2626",
  late: "D97706",
  early_leave: "2563EB",
  suspended: "7E22CE",
};

const BASE_FONT_FAMILY = "Kosugi";
const BASE_FONT_SIZE = 10;

type AttendanceRecord = {
  date: string;
  studentId: string;
  status: AttendanceStatus;
  reason: string;
};

type SheetsClient = ReturnType<typeof getSheetsClient>;

export type ClassSyncResult = { className: string; ok: boolean; error?: string };
export type ReportSyncResult = {
  startedAt: string;
  finishedAt: string;
  classes: ClassSyncResult[];
};

function hexToColor(hex: string): sheets_v4.Schema$Color {
  const h = hex.length === 8 ? hex.slice(2) : hex; // tolerate a leading ARGB alpha byte
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function todayBangkok(): string {
  // Asia/Bangkok is a fixed UTC+7, no DST -- safe to just shift and re-read
  // the UTC date fields rather than pulling in a timezone library.
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function formatBangkok(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 16).replace("T", " ")} (Bangkok)`;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function isWeekendDate(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getDay();
  return dow === 0 || dow === 6;
}

function weekdayLabel(date: string): string {
  return WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getDay()];
}

// ---- Cell/format builders -------------------------------------------------

const HEADER_FORMAT: sheets_v4.Schema$CellFormat = {
  backgroundColor: hexToColor("F3F4F6"),
  textFormat: { fontFamily: BASE_FONT_FAMILY, fontSize: BASE_FONT_SIZE, bold: true },
  horizontalAlignment: "CENTER",
  verticalAlignment: "MIDDLE",
  wrapStrategy: "WRAP",
};

const WEEKEND_HEADER_FORMAT: sheets_v4.Schema$CellFormat = {
  backgroundColor: hexToColor("FFF0DC"),
  textFormat: {
    fontFamily: BASE_FONT_FAMILY,
    fontSize: BASE_FONT_SIZE,
    bold: true,
    foregroundColor: hexToColor("C2410C"),
  },
  horizontalAlignment: "CENTER",
  verticalAlignment: "MIDDLE",
  wrapStrategy: "WRAP",
};

const BASE_DATA_FORMAT: sheets_v4.Schema$CellFormat = {
  textFormat: { fontFamily: BASE_FONT_FAMILY, fontSize: BASE_FONT_SIZE },
  verticalAlignment: "MIDDLE",
};

const NAME_CELL_FORMAT: sheets_v4.Schema$CellFormat = {
  ...BASE_DATA_FORMAT,
  wrapStrategy: "WRAP",
};

const CENTER_DATA_FORMAT: sheets_v4.Schema$CellFormat = {
  ...BASE_DATA_FORMAT,
  horizontalAlignment: "CENTER",
};

const WEEKEND_FILL = hexToColor("FFF7ED");

function statusFormat(status: AttendanceStatus, weekend: boolean): sheets_v4.Schema$CellFormat {
  return {
    backgroundColor: weekend ? WEEKEND_FILL : undefined,
    horizontalAlignment: "CENTER",
    verticalAlignment: "MIDDLE",
    textFormat: {
      fontFamily: BASE_FONT_FAMILY,
      fontSize: BASE_FONT_SIZE,
      bold: true,
      foregroundColor: hexToColor(STATUS_COLOR_HEX[status]),
    },
  };
}

function cell(
  value: string | number | null | undefined,
  format: sheets_v4.Schema$CellFormat
): sheets_v4.Schema$CellData {
  if (value === null || value === undefined || value === "") {
    return { userEnteredFormat: format };
  }
  return {
    userEnteredValue:
      typeof value === "number" ? { numberValue: value } : { stringValue: value },
    userEnteredFormat: format,
  };
}

function buildHeaderRows(
  dates: string[],
  checkHeaders: [string, string, string]
): sheets_v4.Schema$RowData[] {
  const row1: sheets_v4.Schema$CellData[] = [
    cell("#", HEADER_FORMAT),
    cell("名前", HEADER_FORMAT),
    ...dates.map((d) =>
      cell(d.slice(8, 10), isWeekendDate(d) ? WEEKEND_HEADER_FORMAT : HEADER_FORMAT)
    ),
    cell("出", HEADER_FORMAT),
    cell("欠", HEADER_FORMAT),
    cell("欠席理由", HEADER_FORMAT),
    cell(checkHeaders[0], HEADER_FORMAT),
    cell(checkHeaders[1], HEADER_FORMAT),
    cell(checkHeaders[2], HEADER_FORMAT),
    cell("備考", HEADER_FORMAT),
  ];
  const row2: sheets_v4.Schema$CellData[] = [
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    ...dates.map((d) =>
      cell(weekdayLabel(d), isWeekendDate(d) ? WEEKEND_HEADER_FORMAT : HEADER_FORMAT)
    ),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
    cell("", HEADER_FORMAT),
  ];
  return [{ values: row1 }, { values: row2 }];
}

function countsAsPresent(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "early_leave";
}

function buildDataRow(
  index: number,
  student: Student,
  dates: string[],
  statusByDate: Map<string, AttendanceStatus>,
  reasonByDate: Map<string, string>,
  check: { check1: boolean; check2: boolean; check3: boolean } | undefined
): sheets_v4.Schema$RowData {
  let presentCount = 0;
  let absentCount = 0;
  const reasonCounts = new Map<string, number>();
  for (const d of dates) {
    const status = statusByDate.get(d);
    if (!status) continue;
    if (countsAsPresent(status)) presentCount++;
    else absentCount++;
    const reason = reasonByDate.get(d);
    if (reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const reasonSummary = Array.from(reasonCounts.entries())
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
  const nameValue = student.nameEnglish
    ? `${student.nameKanji}\n${student.nameEnglish}`
    : student.nameKanji;

  const values: sheets_v4.Schema$CellData[] = [
    cell(index + 1, CENTER_DATA_FORMAT),
    cell(nameValue, NAME_CELL_FORMAT),
    ...dates.map((d) => {
      const weekend = isWeekendDate(d);
      const status = statusByDate.get(d);
      if (status) return cell(STATUS_LABEL[status], statusFormat(status, weekend));
      return cell(
        null,
        weekend ? { ...CENTER_DATA_FORMAT, backgroundColor: WEEKEND_FILL } : CENTER_DATA_FORMAT
      );
    }),
    cell(presentCount || null, CENTER_DATA_FORMAT),
    cell(absentCount || null, CENTER_DATA_FORMAT),
    cell(reasonSummary || null, BASE_DATA_FORMAT),
    cell(check?.check1 ? "✓" : null, CENTER_DATA_FORMAT),
    cell(check?.check2 ? "✓" : null, CENTER_DATA_FORMAT),
    cell(check?.check3 ? "✓" : null, CENTER_DATA_FORMAT),
    cell(student.remark || null, BASE_DATA_FORMAT),
  ];
  return { values };
}

const CELL_FIELDS =
  "userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy";

function dimensionRequest(
  sheetId: number,
  startIndex: number,
  endIndex: number,
  pixelSize: number
): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex, endIndex },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

// Deletes the old tab (if one exists under this title) and creates a fresh
// one, returning the new numeric sheetId. Both requests go in one
// batchUpdate call since deleteSheet (old id) and addSheet (new tab) are
// independent of each other; every later formatting call needs the id this
// returns, so it has to be awaited on its own first.
async function recreateSheet(
  sheets: SheetsClient,
  title: string,
  gridProperties: sheets_v4.Schema$GridProperties,
  existingSheetId: number | undefined,
  index?: number
): Promise<number> {
  const requests: sheets_v4.Schema$Request[] = [];
  if (existingSheetId != null) {
    requests.push({ deleteSheet: { sheetId: existingSheetId } });
  }
  requests.push({
    addSheet: {
      properties: { title, gridProperties, index },
    },
  });
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: REPORT_SHEET_ID,
    requestBody: { requests },
  });
  const sheetId = res.data.replies?.find((r) => r.addSheet)?.addSheet?.properties?.sheetId;
  if (sheetId == null) throw new Error(`Failed to (re)create sheet tab "${title}"`);
  return sheetId;
}

async function syncClassTab(
  sheets: SheetsClient,
  className: string,
  existingSheetId: number | undefined,
  today: string
): Promise<void> {
  const [students, allAttendance] = await Promise.all([
    getStudentsByClass(className),
    getAllAttendanceForClass(className) as Promise<AttendanceRecord[]>,
  ]);
  const records = allAttendance.filter((r) => r.date >= REPORT_START_DATE && r.date <= today);
  const currentYearMonth = today.slice(0, 7);
  const [checkLabels, monthlyChecksList] = await Promise.all([
    getClassCheckLabels(className, currentYearMonth),
    getMonthlyChecks(className, currentYearMonth),
  ]);
  const monthlyChecks = new Map(monthlyChecksList.map((c) => [c.studentId, c]));

  const dates = dateRange(REPORT_START_DATE, today);
  const totalCols = dates.length + 9;
  const totalRows = 2 + students.length;

  const statusByStudentDate = new Map<string, Map<string, AttendanceStatus>>();
  const reasonByStudentDate = new Map<string, Map<string, string>>();
  for (const r of records) {
    if (!statusByStudentDate.has(r.studentId)) statusByStudentDate.set(r.studentId, new Map());
    statusByStudentDate.get(r.studentId)!.set(r.date, r.status);
    if (r.reason) {
      if (!reasonByStudentDate.has(r.studentId)) reasonByStudentDate.set(r.studentId, new Map());
      reasonByStudentDate.get(r.studentId)!.set(r.date, r.reason);
    }
  }

  const sheetId = await recreateSheet(
    sheets,
    className,
    { frozenRowCount: 2, frozenColumnCount: 2, rowCount: totalRows, columnCount: totalCols },
    existingSheetId
  );

  const checkHeaders: [string, string, string] = [
    checkLabels.check1Label || "チェック1",
    checkLabels.check2Label || "チェック2",
    checkLabels.check3Label || "チェック3",
  ];
  const headerRows = buildHeaderRows(dates, checkHeaders);
  const dataRows = students.map((s, i) =>
    buildDataRow(
      i,
      s,
      dates,
      statusByStudentDate.get(s.studentId) ?? new Map(),
      reasonByStudentDate.get(s.studentId) ?? new Map(),
      monthlyChecks.get(s.studentId)
    )
  );

  const requests: sheets_v4.Schema$Request[] = [
    {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: totalRows,
          startColumnIndex: 0,
          endColumnIndex: totalCols,
        },
        rows: [...headerRows, ...dataRows],
        fields: CELL_FIELDS,
      },
    },
  ];

  // Non-date columns span both header rows as one merged cell -- #, 名前,
  // 出, 欠, 欠席理由, 3×check, 備考. Date columns stay unmerged (day number
  // and weekday on separate header rows -- narrow columns can't fit both
  // on one line, same reasoning as the Excel export).
  const nonDateCols = [
    0,
    1,
    2 + dates.length,
    3 + dates.length,
    4 + dates.length,
    5 + dates.length,
    6 + dates.length,
    7 + dates.length,
    8 + dates.length,
  ];
  for (const col of nonDateCols) {
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: col, endColumnIndex: col + 1 },
        mergeType: "MERGE_ALL",
      },
    });
  }

  // Column widths -- approximate ExcelJS "character width" -> Sheets pixel
  // conversion (~7px/char); spot-check visually and adjust if columns look
  // off once real data is in there.
  const px = (chars: number) => Math.round(chars * 7);
  requests.push(dimensionRequest(sheetId, 0, 1, px(4))); // #
  requests.push(dimensionRequest(sheetId, 1, 2, px(20))); // 名前
  requests.push(dimensionRequest(sheetId, 2, 2 + dates.length, px(3.5))); // day columns
  requests.push(dimensionRequest(sheetId, 2 + dates.length, 4 + dates.length, px(5))); // 出/欠
  requests.push(dimensionRequest(sheetId, 4 + dates.length, 5 + dates.length, px(20))); // 欠席理由
  requests.push(dimensionRequest(sheetId, 5 + dates.length, 8 + dates.length, px(10))); // 3×check
  requests.push(dimensionRequest(sheetId, 8 + dates.length, 9 + dates.length, px(24))); // 備考

  const thinGray: sheets_v4.Schema$Border = { style: "SOLID", color: hexToColor("B0B0B0") };
  requests.push({
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: totalRows,
        startColumnIndex: 0,
        endColumnIndex: totalCols,
      },
      top: thinGray,
      bottom: thinGray,
      left: thinGray,
      right: thinGray,
      innerHorizontal: thinGray,
      innerVertical: thinGray,
    },
  });

  // The bare "01".."31" day-number header repeats with no month name once
  // the range crosses a month boundary (it will almost immediately) --
  // mark the first column of each new month with a slightly heavier left
  // border so it's at least visually legible which stretch is which month.
  const monthBorder: sheets_v4.Schema$Border = { style: "SOLID_MEDIUM", color: hexToColor("6B7280") };
  dates.forEach((d, idx) => {
    if (d.slice(8, 10) !== "01") return;
    const col = 2 + idx;
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: col, endColumnIndex: col + 1 },
        left: monthBorder,
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: REPORT_SHEET_ID,
    requestBody: { requests },
  });
}

async function syncInfoTab(
  sheets: SheetsClient,
  existingSheetId: number | undefined,
  results: ClassSyncResult[],
  startedAt: string,
  finishedAt: string
): Promise<void> {
  const totalRows = 3 + results.length;
  const sheetId = await recreateSheet(
    sheets,
    "Sync Info",
    { frozenRowCount: 1, rowCount: totalRows, columnCount: 2 },
    existingSheetId,
    0
  );

  const boldFormat: sheets_v4.Schema$CellFormat = {
    textFormat: { fontFamily: BASE_FONT_FAMILY, fontSize: BASE_FONT_SIZE, bold: true },
    verticalAlignment: "MIDDLE",
  };
  const plainFormat: sheets_v4.Schema$CellFormat = {
    textFormat: { fontFamily: BASE_FONT_FAMILY, fontSize: BASE_FONT_SIZE },
    verticalAlignment: "MIDDLE",
  };
  const errorFormat: sheets_v4.Schema$CellFormat = {
    textFormat: {
      fontFamily: BASE_FONT_FAMILY,
      fontSize: BASE_FONT_SIZE,
      foregroundColor: hexToColor("DC2626"),
    },
    verticalAlignment: "MIDDLE",
  };

  const rows: sheets_v4.Schema$RowData[] = [
    { values: [cell("最終同期 Last synced", boldFormat), cell(formatBangkok(finishedAt), plainFormat)] },
    { values: [cell("開始時刻 Started", boldFormat), cell(formatBangkok(startedAt), plainFormat)] },
    { values: [cell("クラス Class", boldFormat), cell("状態 Status", boldFormat)] },
    ...results.map((r) => ({
      values: [
        cell(r.className, plainFormat),
        cell(r.ok ? "OK" : `Error: ${r.error}`, r.ok ? plainFormat : errorFormat),
      ],
    })),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: REPORT_SHEET_ID,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: 2 },
            rows,
            fields: CELL_FIELDS,
          },
        },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 320 }, fields: "pixelSize" } },
      ],
    },
  });
}

export async function syncReport(): Promise<ReportSyncResult> {
  if (!REPORT_SHEET_ID) {
    throw new Error("Missing REPORT_SHEET_ID env var");
  }
  const sheets = getSheetsClient();
  const startedAt = new Date().toISOString();
  const today = todayBangkok();
  if (today < REPORT_START_DATE) {
    throw new Error(`REPORT_START_DATE (${REPORT_START_DATE}) is in the future`);
  }

  const extraClasses = await getExtraClasses();
  const targetClasses: string[] = [
    ...CLASSES,
    ...extraClasses.filter((c) => c.active).map((c) => `${c.branch}　${c.suffix}`),
  ];

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: REPORT_SHEET_ID,
    fields: "sheets.properties",
  });
  const existingIdByTitle = new Map<string, number>();
  for (const s of meta.data.sheets ?? []) {
    if (s.properties?.title && s.properties.sheetId != null) {
      existingIdByTitle.set(s.properties.title, s.properties.sheetId);
    }
  }

  const results: ClassSyncResult[] = [];
  for (const className of targetClasses) {
    try {
      await syncClassTab(sheets, className, existingIdByTitle.get(className), today);
      results.push({ className, ok: true });
    } catch (err) {
      results.push({ className, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const finishedAt = new Date().toISOString();
  await syncInfoTab(sheets, existingIdByTitle.get("Sync Info"), results, startedAt, finishedAt);

  return { startedAt, finishedAt, classes: results };
}
