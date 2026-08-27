import { google } from "googleapis";
import { romajiToHiragana } from "./romajiToHiragana";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars"
    );
  }

  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

/**
 * Wraps sheets.spreadsheets.values.get() so that a tab which has been
 * fully emptied down to just its header row (e.g. via a "delete all"
 * feature, which removes ROWS through the grid, not just cell content)
 * doesn't break every future read. Once a sheet's grid shrinks to exactly
 * 1 row, a range like "Sheet!A2:D" no longer exists at all and Google
 * returns a 400 "exceeds grid limits" error instead of an empty result --
 * that specific error is treated as "no data" here, same as if the range
 * had simply come back empty. Every read in this file goes through this,
 * not sheets.spreadsheets.values.get() directly.
 */
async function safeValuesGet(
  sheets: ReturnType<typeof getSheetsClient>,
  params: { spreadsheetId: string; range: string }
): Promise<{ data: { values?: string[][] | null } }> {
  try {
    return await sheets.spreadsheets.values.get(params);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exceeds grid limits/i.test(message)) {
      return { data: { values: [] } };
    }
    throw err;
  }
}

async function getSheetIdByTitle(
  sheets: ReturnType<typeof getSheetsClient>,
  title: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties",
  });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === title);
  if (sheet?.properties?.sheetId == null) {
    throw new Error(`Sheet tab "${title}" not found`);
  }
  return sheet.properties.sheetId;
}

export type Student = {
  studentId: string;
  nameKanji: string;
  nameEnglish: string;
  className: string;
  active: boolean;
  remark: string;
  /** Generic, meaning-free checkboxes (チェック1/2/3) — up to the teacher. */
  check1: boolean;
  check2: boolean;
  check3: boolean;
  /**
   * Manual display order within a class (lower shows first) — e.g. the
   * school lines students up by birthdate, which nothing in the sheet
   * captures on its own, so this is a free-standing sort key the roster
   * page's ↑/↓ buttons swap between neighbors. Every other list (Dashboard,
   * 出席確認, 年間まとめ, exports, 送迎管理) reads students in this same
   * order for free, since they all ultimately go through the functions
   * below rather than re-sorting on their own.
   */
  sortOrder: number;
  /**
   * Best-effort auto-filled from nameEnglish via romajiToHiragana() at
   * registration time (see addStudent/addStudentsBulk) -- a starting point,
   * not authoritative, since romaji-to-hiragana readings are genuinely
   * ambiguous. Editable afterward via the name-edit screen like the other
   * two name fields.
   */
  nameHiragana: string;
};

/** Parses column J (sort_order); blank/non-numeric rows sort after every
 *  real value but keep their relative sheet order among each other, since
 *  Array.prototype.sort is stable and they all map to the same fallback. */
function parseSortOrder(raw: string | undefined): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function sortStudentsByOrder(students: Student[]): Student[] {
  return [...students].sort((a, b) => a.sortOrder - b.sortOrder);
}

export type CheckColumn = "check1" | "check2" | "check3";
const CHECK_COLUMN_LETTERS: Record<CheckColumn, string> = {
  check1: "G",
  check2: "H",
  check3: "I",
};

// 出席 (present) / 欠席 (absent) / 遅刻 (late) / 早退 (early leave) /
// 出席停止 (attendance suspended, e.g. quarantine)
export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "early_leave"
  | "suspended";

const VALID_STATUSES: AttendanceStatus[] = [
  "present",
  "absent",
  "late",
  "early_leave",
  "suspended",
];

/** Whether a status counts toward the 出 (present) total vs the 欠 (absent) total. */
export function countsAsPresent(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "early_leave";
}

function parseStatus(raw: string): AttendanceStatus {
  const upper = raw.toString().toUpperCase();
  if (upper === "TRUE") return "present"; // backward-compat with old boolean data
  if (upper === "FALSE") return "absent";
  return VALID_STATUSES.includes(raw as AttendanceStatus)
    ? (raw as AttendanceStatus)
    : "present";
}

export type AttendanceRecord = {
  date: string;
  className: string;
  studentId: string;
  status: AttendanceStatus;
  timestamp: string;
  /** Free-text detail, e.g. which of 都合欠/病欠/インフルエンザ/... this is. */
  reason: string;
};

/** Read all students for a given class (active only), in display order. */
export async function getStudentsByClass(className: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Students!A2:K",
  });

  const rows = res.data.values ?? [];

  return sortStudentsByOrder(
    rows
      .map((row): Student => ({
        studentId: row[0] ?? "",
        nameKanji: row[1] ?? "",
        nameEnglish: row[2] ?? "",
        className: row[3] ?? "",
        active: (row[4] ?? "").toString().toUpperCase() === "TRUE",
        remark: row[5] ?? "",
        check1: (row[6] ?? "").toString().toUpperCase() === "TRUE",
        check2: (row[7] ?? "").toString().toUpperCase() === "TRUE",
        check3: (row[8] ?? "").toString().toUpperCase() === "TRUE",
        sortOrder: parseSortOrder(row[9]),
        nameHiragana: row[10] ?? "",
      }))
      .filter((s) => s.studentId && s.className === className && s.active)
  );
}

/**
 * Every active student across all classes in one branch (all grades,
 * including 小学生) — used by 送迎管理, which is a whole-branch roster,
 * not scoped to a single locked-in class the way every other page is.
 */
export async function getStudentsByBranch(branch: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Students!A2:K",
  });
  const rows = res.data.values ?? [];
  return sortStudentsByOrder(
    rows
      .map((row): Student => ({
        studentId: row[0] ?? "",
        nameKanji: row[1] ?? "",
        nameEnglish: row[2] ?? "",
        className: row[3] ?? "",
        active: (row[4] ?? "").toString().toUpperCase() === "TRUE",
        remark: row[5] ?? "",
        check1: (row[6] ?? "").toString().toUpperCase() === "TRUE",
        check2: (row[7] ?? "").toString().toUpperCase() === "TRUE",
        check3: (row[8] ?? "").toString().toUpperCase() === "TRUE",
        sortOrder: parseSortOrder(row[9]),
        nameHiragana: row[10] ?? "",
      }))
      .filter((s) => s.studentId && s.active && s.className.startsWith(branch))
  );
}

/**
 * Next free sort_order value(s) — one past the current sheet-wide max,
 * stepping by 10 so newly-added students land at the bottom of the
 * display order by default (same as today's plain append), leaving room
 * to move them up later without renumbering anyone else.
 */
async function getNextSortOrders(
  sheets: ReturnType<typeof getSheetsClient>,
  count: number
): Promise<number[]> {
  const res = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "Students!J2:J",
  });
  const rows = res.data.values ?? [];
  let max = 0;
  for (const row of rows) {
    const n = Number(row[0]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => max + (i + 1) * 10);
}

/**
 * Strips a stray leading/trailing quote mark (straight or curly) picked up
 * when a browser pastes a spreadsheet cell that itself contained a line
 * break — clipboard TSV export wraps such a cell in quotes per CSV escaping
 * rules, and pasting "as plain text" carries the literal quote characters
 * along instead of unescaping them (seen firsthand: a 2-line 名前 cell
 * pasted via parseBulkNamesTwoLine left a leading " on the kanji line and
 * a trailing " on the romaji line). Real names never intentionally start
 * or end with a quote mark, so this is safe to always apply.
 */
function stripStrayQuotes(s: string): string {
  return s.replace(/^["“”]+/, "").replace(/["“”]+$/, "").trim();
}

function looksLikeRomaji(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length > 0 && /^[a-zA-Z\s]+$/.test(trimmed);
}

/**
 * Best-effort Hiragana reading for a new student — normally derived from
 * nameEnglish, but falls back to nameKanji itself when that field was
 * filled in with a plain romaji string instead of actual kanji (seen in
 * older records predating the separate English-name field).
 */
function deriveNameHiragana(nameKanji: string, nameEnglish: string): string {
  const source = nameEnglish.trim() || (looksLikeRomaji(nameKanji) ? nameKanji : "");
  return romajiToHiragana(source);
}

/** Append a new student row to the Students sheet. nameHiragana is
 *  auto-filled -- a best-effort starting point the operator can correct
 *  via the name-edit screen. */
export async function addStudent(
  student: Omit<
    Student,
    "active" | "remark" | "check1" | "check2" | "check3" | "sortOrder" | "nameHiragana"
  >
): Promise<void> {
  const sheets = getSheetsClient();
  const [nextOrder] = await getNextSortOrders(sheets, 1);
  const nameKanji = stripStrayQuotes(student.nameKanji);
  const nameEnglish = stripStrayQuotes(student.nameEnglish);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Students!A:K",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          student.studentId,
          nameKanji,
          nameEnglish,
          student.className,
          "TRUE",
          "",
          "FALSE",
          "FALSE",
          "FALSE",
          String(nextOrder),
          deriveNameHiragana(nameKanji, nameEnglish),
        ],
      ],
    },
  });
}

/**
 * Append many new student rows in a single request — used by the bulk
 * "paste one name per line" add tool so registering a whole new intake
 * doesn't mean N separate round trips (and N chances to hit quota).
 */
export async function addStudentsBulk(
  students: Omit<
    Student,
    "active" | "remark" | "check1" | "check2" | "check3" | "sortOrder" | "nameHiragana"
  >[]
): Promise<void> {
  if (students.length === 0) return;
  const sheets = getSheetsClient();
  const orders = await getNextSortOrders(sheets, students.length);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Students!A:K",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: students.map((s, i) => {
        const nameKanji = stripStrayQuotes(s.nameKanji);
        const nameEnglish = stripStrayQuotes(s.nameEnglish);
        return [
          s.studentId,
          nameKanji,
          nameEnglish,
          s.className,
          "TRUE",
          "",
          "FALSE",
          "FALSE",
          "FALSE",
          String(orders[i]),
          deriveNameHiragana(nameKanji, nameEnglish),
        ];
      }),
    },
  });
}

/**
 * Read every student in a class, active or not — used for the "withdrawn/
 * graduated" list, which getStudentsByClass deliberately excludes.
 */
export async function getAllStudentsByClass(className: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Students!A2:K",
  });
  const rows = res.data.values ?? [];
  return sortStudentsByOrder(
    rows
      .map((row): Student => ({
        studentId: row[0] ?? "",
        nameKanji: row[1] ?? "",
        nameEnglish: row[2] ?? "",
        className: row[3] ?? "",
        active: (row[4] ?? "").toString().toUpperCase() === "TRUE",
        remark: row[5] ?? "",
        check1: (row[6] ?? "").toString().toUpperCase() === "TRUE",
        check2: (row[7] ?? "").toString().toUpperCase() === "TRUE",
        check3: (row[8] ?? "").toString().toUpperCase() === "TRUE",
        sortOrder: parseSortOrder(row[9]),
        nameHiragana: row[10] ?? "",
      }))
      .filter((s) => s.studentId && s.className === className)
  );
}

async function findStudentRowNumber(
  sheets: ReturnType<typeof getSheetsClient>,
  studentId: string
): Promise<number | null> {
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Students!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === studentId);
  return rowOffset === -1 ? null : rowOffset + 2; // 1-based, +1 for header
}

/**
 * Corrects a student's name in place -- every page reads nameKanji/
 * nameEnglish/nameHiragana live from this same row, so this is the one
 * place a fix needs to happen for it to show up everywhere (Dashboard,
 * 出席確認, 年間まとめ, 送迎管理, etc.).
 */
export async function updateStudentName(
  studentId: string,
  nameKanji: string,
  nameEnglish: string,
  nameHiragana: string
): Promise<void> {
  const sheets = getSheetsClient();
  const rowNum = await findStudentRowNumber(sheets, studentId);
  if (rowNum === null) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `Students!B${rowNum}:C${rowNum}`,
          values: [[stripStrayQuotes(nameKanji), stripStrayQuotes(nameEnglish)]],
        },
        {
          range: `Students!K${rowNum}`,
          values: [[stripStrayQuotes(nameHiragana)]],
        },
      ],
    },
  });
}

/** Update a single student's remark (備考) note in place. */
export async function updateStudentRemark(
  studentId: string,
  remark: string
): Promise<void> {
  const sheets = getSheetsClient();
  const rowNum = await findStudentRowNumber(sheets, studentId);
  if (rowNum === null) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Students!F${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[remark]] },
  });
}

/**
 * Swaps a student's display position with its neighbor within the same
 * class's ACTIVE roster (matching what the roster page actually shows) --
 * a no-op if the student is already at that end of the list, or isn't
 * found/isn't active. Every page that lists students by class picks this
 * order up automatically since they all read through getStudentsByClass/
 * getAllStudentsByClass/getStudentsByBranch, which sort by sort_order.
 */
export async function moveStudentOrder(
  studentId: string,
  direction: "up" | "down"
): Promise<void> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "Students!A2:J",
  });
  const rows = res.data.values ?? [];

  const target = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .find(({ row }) => (row[0] ?? "") === studentId);
  if (!target) return;

  const className = target.row[3] ?? "";
  const isActive = (target.row[4] ?? "").toString().toUpperCase() === "TRUE";
  if (!isActive) return;

  const siblings = rows
    .map((row, i) => ({
      studentId: row[0] ?? "",
      rowNum: i + 2,
      sortOrder: parseSortOrder(row[9]),
    }))
    .filter((_, i) => {
      const row = rows[i];
      return (
        (row[0] ?? "") &&
        (row[3] ?? "") === className &&
        (row[4] ?? "").toString().toUpperCase() === "TRUE"
      );
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const idx = siblings.findIndex((s) => s.studentId === studentId);
  if (idx === -1) return;
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return; // already at that end

  const a = siblings[idx];
  const b = siblings[neighborIdx];
  // If either side never got backfilled (shouldn't happen post-migration,
  // but parseSortOrder falls back to a shared sentinel for blanks), give
  // it a real distinct value based on its row rather than writing the
  // sentinel itself into the sheet.
  const aOrder = Number.isFinite(a.sortOrder) && a.sortOrder !== Number.MAX_SAFE_INTEGER
    ? a.sortOrder
    : a.rowNum * 10;
  const bOrder = Number.isFinite(b.sortOrder) && b.sortOrder !== Number.MAX_SAFE_INTEGER
    ? b.sortOrder
    : b.rowNum * 10;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Students!J${a.rowNum}`, values: [[String(bOrder)]] },
        { range: `Students!J${b.rowNum}`, values: [[String(aOrder)]] },
      ],
    },
  });
}

/**
 * Moves a student to a different class (a real transfer, not a
 * withdraw/re-add) -- only changes the Students row's own className
 * field. Historical Attendance/OutingLog/MonthlyChecks rows are
 * deliberately left as-is, since they already correctly recorded which
 * class the student was actually in on each past date; new records
 * created after the move naturally get tagged with the new class since
 * check-in/etc. always use whatever a student's current className is.
 * StudentLocations/StudentTransport/PickupLog aren't touched either --
 * they're keyed by studentId alone, not className, so they already follow
 * the student automatically.
 */
export async function updateStudentClass(
  studentId: string,
  className: string
): Promise<void> {
  const sheets = getSheetsClient();
  const rowNum = await findStudentRowNumber(sheets, studentId);
  if (rowNum === null) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Students!D${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[className]] },
  });
}

/** Toggle one of a student's generic, meaning-free checkboxes. */
export async function updateStudentCheck(
  studentId: string,
  column: CheckColumn,
  value: boolean
): Promise<void> {
  const sheets = getSheetsClient();
  const rowNum = await findStudentRowNumber(sheets, studentId);
  if (rowNum === null) return;

  const colLetter = CHECK_COLUMN_LETTERS[column];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Students!${colLetter}${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value ? "TRUE" : "FALSE"]] },
  });
}

/**
 * Mark a student active/inactive (withdrawn or graduated). Soft-delete only
 * — the row and all their past attendance history stay in the sheet, they
 * just stop showing up in the active roster / class-locked pages.
 */
export async function setStudentActive(studentId: string, active: boolean): Promise<void> {
  const sheets = getSheetsClient();
  const rowNum = await findStudentRowNumber(sheets, studentId);
  if (rowNum === null) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Students!E${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[active ? "TRUE" : "FALSE"]] },
  });
}

/**
 * Soft-delete every currently active student in a class at once (e.g. to
 * quickly undo a bulk-add that went into the wrong class) — one batched
 * write, not N, same reasoning as the old promoteClassStudents. Still
 * fully recoverable one-by-one from the "removed students" list.
 */
export async function deactivateAllStudents(
  className: string
): Promise<{ studentId: string; nameKanji: string }[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Students!A2:I",
  });
  const rows = res.data.values ?? [];

  const targets = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(
      ({ row }) =>
        (row[0] ?? "") &&
        (row[3] ?? "") === className &&
        (row[4] ?? "").toString().toUpperCase() === "TRUE"
    );

  if (targets.length === 0) return [];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: targets.map(({ rowNum }) => ({
        range: `Students!E${rowNum}`,
        values: [["FALSE"]],
      })),
    },
  });

  return targets.map(({ row }) => ({ studentId: row[0] ?? "", nameKanji: row[1] ?? "" }));
}

/**
 * Present-student count per class for a single date, across every class
 * in the sheet. Classes with no rows at all for that date are omitted —
 * that's how the caller tells "not checked in yet" apart from "checked
 * in, zero present". 遅刻/早退 count as present; 出席停止 counts as absent.
 */
export async function getAttendanceSummaryForDate(
  date: string // "2026-08-06"
): Promise<Record<string, number>> {
  const sheets = getSheetsClient();
  const [attendanceRes, studentsRes] = await Promise.all([
    safeValuesGet(sheets,{ spreadsheetId: SHEET_ID, range: "Attendance!A2:F" }),
    safeValuesGet(sheets,{ spreadsheetId: SHEET_ID, range: "Students!A2:E" }),
  ]);

  // Only count rows for students still on the active roster — otherwise a
  // withdrawn/reset student's old attendance row keeps inflating this
  // live "who's checked in today" badge forever, even for a class with
  // zero active students (e.g. right after the end-of-term Reset).
  const activeStudentIds = new Set(
    (studentsRes.data.values ?? [])
      .filter((row) => (row[4] ?? "").toString().toUpperCase() === "TRUE")
      .map((row) => (row[0] ?? "").toString())
  );

  const rows = attendanceRes.data.values ?? [];
  const summary: Record<string, number> = {};

  for (const row of rows) {
    const rowDate = (row[0] ?? "").toString();
    if (rowDate !== date) continue;
    const className = (row[1] ?? "").toString();
    if (!className) continue;
    const studentId = (row[2] ?? "").toString();
    if (!activeStudentIds.has(studentId)) continue;
    const status = parseStatus((row[3] ?? "").toString());
    if (!(className in summary)) summary[className] = 0;
    if (countsAsPresent(status)) summary[className]++;
  }

  return summary;
}

type AttendanceRow = {
  date: string;
  studentId: string;
  status: AttendanceStatus;
  reason: string;
};

/** Read every attendance record for a class within a given YYYY-MM month. */
export async function getAttendanceForMonth(
  className: string,
  yearMonth: string // "2026-08"
): Promise<AttendanceRow[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      className: (row[1] ?? "").toString(),
      studentId: (row[2] ?? "").toString(),
      status: parseStatus((row[3] ?? "").toString()),
      reason: (row[5] ?? "").toString(),
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.date.startsWith(yearMonth) &&
        r.studentId
    )
    .map((r) => ({
      date: r.date,
      studentId: r.studentId,
      status: r.status,
      reason: r.reason,
    }));
}

/**
 * Read every attendance record for a class within a Japanese school year
 * (April of `fiscalYearStartYear` through March of the following year).
 */
export async function getAttendanceForFiscalYear(
  className: string,
  fiscalYearStartYear: number
): Promise<AttendanceRow[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });

  const rows = res.data.values ?? [];
  const startDate = `${fiscalYearStartYear}-04-01`;
  const endDate = `${fiscalYearStartYear + 1}-03-31`;

  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      className: (row[1] ?? "").toString(),
      studentId: (row[2] ?? "").toString(),
      status: parseStatus((row[3] ?? "").toString()),
      reason: (row[5] ?? "").toString(),
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.studentId &&
        r.date >= startDate &&
        r.date <= endDate
    )
    .map((r) => ({
      date: r.date,
      studentId: r.studentId,
      status: r.status,
      reason: r.reason,
    }));
}

/**
 * Every attendance row ever recorded for a class, no date bound at all —
 * used only for the end-of-term Reset backup export, right before the
 * roster is wiped, so nothing is lost even from years before the current
 * fiscal year.
 */
export async function getAllAttendanceForClass(className: string): Promise<AttendanceRow[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      className: (row[1] ?? "").toString(),
      studentId: (row[2] ?? "").toString(),
      status: parseStatus((row[3] ?? "").toString()),
      reason: (row[5] ?? "").toString(),
    }))
    .filter((r) => r.className === className && r.studentId)
    .map((r) => ({ date: r.date, studentId: r.studentId, status: r.status, reason: r.reason }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Write attendance rows, updating any existing row for the same
 * date+student in place instead of appending a duplicate. This is what
 * lets both the daily check-in flow and the dashboard's per-cell edits
 * safely re-save a day without the sheet accumulating duplicate rows.
 */
export async function upsertAttendance(records: AttendanceRecord[]): Promise<void> {
  if (records.length === 0) return;

  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });
  const rows = existing.data.values ?? [];

  // key -> sheet row number (1-based, header is row 1)
  const rowIndex = new Map<string, number>();
  rows.forEach((row, i) => {
    const date = row[0] ?? "";
    const studentId = row[2] ?? "";
    if (date && studentId) rowIndex.set(`${date}|${studentId}`, i + 2);
  });

  const updates: { range: string; values: string[][] }[] = [];
  const toAppend: AttendanceRecord[] = [];

  for (const r of records) {
    const key = `${r.date}|${r.studentId}`;
    const rowNum = rowIndex.get(key);
    const values = [
      [r.date, r.className, r.studentId, r.status, r.timestamp, r.reason ?? ""],
    ];
    if (rowNum) {
      updates.push({ range: `Attendance!A${rowNum}:F${rowNum}`, values });
    } else {
      toAppend.push(r);
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    });
  }

  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Attendance!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: toAppend.map((r) => [
          r.date,
          r.className,
          r.studentId,
          r.status,
          r.timestamp,
          r.reason ?? "",
        ]),
      },
    });
  }
}

/**
 * Remove any attendance row for a given date+student, returning the cell
 * to a truly blank ("not checked yet") state rather than present/absent.
 */
export async function clearAttendance(
  date: string,
  studentId: string
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });
  const rows = existing.data.values ?? [];

  // Delete every row for this date+student, not just the first — a stray
  // duplicate (e.g. from a retried submission) left behind would otherwise
  // make the cell look un-cleared after this "successfully" runs.
  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => (row[0] ?? "") === date && (row[2] ?? "") === studentId)
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return; // already blank, nothing to do

  const sheetId = await getSheetIdByTitle(sheets, "Attendance");

  // Highest row index first so deleting one doesn't shift the indices of
  // the requests still queued after it in this same batch.
  rowNums.sort((a, b) => b - a);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNum - 1, // 0-based, inclusive
            endIndex: rowNum, // 0-based, exclusive
          },
        },
      })),
    },
  });
}

/**
 * Clear every student's attendance row for one class+date at once — for
 * undoing a whole day submitted wrong (e.g. checked in against the wrong
 * date by mistake), instead of clearing each student's cell one at a
 * time. Returns how many rows were removed, for the confirm UI.
 */
export async function clearAttendanceForDate(
  className: string,
  date: string
): Promise<number> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:F",
  });
  const rows = existing.data.values ?? [];

  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => (row[0] ?? "") === date && (row[1] ?? "") === className)
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return 0;

  const sheetId = await getSheetIdByTitle(sheets, "Attendance");
  rowNums.sort((a, b) => b - a);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      })),
    },
  });
  return rowNums.length;
}

// Per-class, per-MONTH custom labels for the 3 generic checkbox columns
// (チェック1/2/3) — a label typed in for August has no bearing on
// September; each month starts blank. Columns:
// A=className, B=yearMonth, C=check1Label, D=check2Label, E=check3Label.
export type ClassCheckLabels = {
  check1Label: string;
  check2Label: string;
  check3Label: string;
};

const CHECK_LABEL_COLUMN_LETTERS: Record<keyof ClassCheckLabels, string> = {
  check1Label: "C",
  check2Label: "D",
  check3Label: "E",
};

/** Read a class's custom checkbox column labels for one month (blank strings if unset). */
export async function getClassCheckLabels(
  className: string,
  yearMonth: string
): Promise<ClassCheckLabels> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ClassSettings!A2:E",
  });
  const rows = res.data.values ?? [];
  const row = rows.find((r) => (r[0] ?? "") === className && (r[1] ?? "") === yearMonth);
  return {
    check1Label: row?.[2] ?? "",
    check2Label: row?.[3] ?? "",
    check3Label: row?.[4] ?? "",
  };
}

/** Set one of a class's custom checkbox column labels for one month. */
export async function updateClassCheckLabel(
  className: string,
  yearMonth: string,
  column: keyof ClassCheckLabels,
  label: string
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ClassSettings!A2:B",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex(
    (row) => (row[0] ?? "") === className && (row[1] ?? "") === yearMonth
  );

  const colLetter = CHECK_LABEL_COLUMN_LETTERS[column];

  if (rowOffset === -1) {
    // no row for this class+month yet — append one
    const values =
      column === "check1Label"
        ? [className, yearMonth, label, "", ""]
        : column === "check2Label"
          ? [className, yearMonth, "", label, ""]
          : [className, yearMonth, "", "", label];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "ClassSettings!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return;
  }

  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `ClassSettings!${colLetter}${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[label]] },
  });
}

// Per-student, per-MONTH state for the same 3 generic checkboxes —
// checking one in August has no bearing on September, matching the
// labels above. One row per student+month, upsert-in-place.
export type MonthlyCheckColumn = "check1" | "check2" | "check3";
export type MonthlyCheckRecord = {
  studentId: string;
  check1: boolean;
  check2: boolean;
  check3: boolean;
};

const MONTHLY_CHECK_COLUMN_LETTERS: Record<MonthlyCheckColumn, string> = {
  check1: "D",
  check2: "E",
  check3: "F",
};

/** Every student's checkbox state for one class+month (students with no row yet are simply absent — treat as all-false). */
export async function getMonthlyChecks(
  className: string,
  yearMonth: string
): Promise<MonthlyCheckRecord[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "MonthlyChecks!A2:F",
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((r) => (r[0] ?? "") === yearMonth && (r[1] ?? "") === className)
    .map((r) => ({
      studentId: (r[2] ?? "").toString(),
      check1: (r[3] ?? "").toString().toUpperCase() === "TRUE",
      check2: (r[4] ?? "").toString().toUpperCase() === "TRUE",
      check3: (r[5] ?? "").toString().toUpperCase() === "TRUE",
    }))
    .filter((r) => r.studentId);
}

/** Set one student's checkbox for one class+month, creating the row if it doesn't exist yet. */
export async function setMonthlyCheck(
  className: string,
  yearMonth: string,
  studentId: string,
  column: MonthlyCheckColumn,
  value: boolean
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "MonthlyChecks!A2:C",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex(
    (row) =>
      (row[0] ?? "") === yearMonth &&
      (row[1] ?? "") === className &&
      (row[2] ?? "") === studentId
  );

  const colLetter = MONTHLY_CHECK_COLUMN_LETTERS[column];

  if (rowOffset === -1) {
    const values =
      column === "check1"
        ? [yearMonth, className, studentId, value ? "TRUE" : "FALSE", "FALSE", "FALSE"]
        : column === "check2"
          ? [yearMonth, className, studentId, "FALSE", value ? "TRUE" : "FALSE", "FALSE"]
          : [yearMonth, className, studentId, "FALSE", "FALSE", value ? "TRUE" : "FALSE"];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "MonthlyChecks!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return;
  }

  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `MonthlyChecks!${colLetter}${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value ? "TRUE" : "FALSE"]] },
  });
}

// 専門コーチ (specialist coach) checklist — a simple per-branch, per-day
// checklist unrelated to student attendance. Rows are user-defined
// categories (e.g. "英語", "ダンス"); each has one checkbox per grade
// (長/中/少) per day. Categories are keyed by a stable UUID so renaming
// one doesn't orphan its past checked days.
export type SpecialistCategory = {
  categoryId: string;
  branch: string;
  name: string;
};

export type SpecialistCheckedCell = {
  categoryId: string;
  grade: string; // "長" | "中" | "少"
  date: string; // "YYYY-MM-DD"
};

export async function getSpecialistCategories(
  branch: string
): Promise<SpecialistCategory[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistCategories!A2:C",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      categoryId: (row[0] ?? "").toString(),
      branch: (row[1] ?? "").toString(),
      name: (row[2] ?? "").toString(),
    }))
    .filter((c) => c.categoryId && c.branch === branch);
}

export async function addSpecialistCategory(
  input: SpecialistCategory
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "SpecialistCategories!A:C",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[input.categoryId, input.branch, input.name]] },
  });
}

export async function renameSpecialistCategory(
  categoryId: string,
  name: string
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistCategories!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === categoryId);
  if (rowOffset === -1) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `SpecialistCategories!C${rowOffset + 2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[name]] },
  });
}

export async function deleteSpecialistCategory(categoryId: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistCategories!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === categoryId);
  if (rowOffset === -1) return;

  const sheetId = await getSheetIdByTitle(sheets, "SpecialistCategories");
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNum - 1,
              endIndex: rowNum,
            },
          },
        },
      ],
    },
  });
}

/** All checked cells for a branch within one calendar month. */
export async function getSpecialistAttendance(
  branch: string,
  yearMonth: string // "2026-08"
): Promise<SpecialistCheckedCell[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistAttendance!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      branch: (row[1] ?? "").toString(),
      categoryId: (row[2] ?? "").toString(),
      grade: (row[3] ?? "").toString(),
    }))
    .filter(
      (r) => r.branch === branch && r.date.startsWith(yearMonth) && r.categoryId
    )
    .map((r) => ({ categoryId: r.categoryId, grade: r.grade, date: r.date }));
}

/**
 * A row's mere existence means "checked" — there is no separate boolean
 * column. Checking appends a row (no-op if already checked); unchecking
 * deletes every matching row (defensively — see the Attendance sheet's
 * duplicate-row lesson, clearAttendance above).
 */
export async function setSpecialistChecked(
  branch: string,
  categoryId: string,
  grade: string,
  date: string,
  checked: boolean
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistAttendance!A2:D",
  });
  const rows = existing.data.values ?? [];
  const matchingRowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(
      ({ row }) =>
        (row[0] ?? "") === date &&
        (row[1] ?? "") === branch &&
        (row[2] ?? "") === categoryId &&
        (row[3] ?? "") === grade
    )
    .map(({ rowNum }) => rowNum);

  if (checked) {
    if (matchingRowNums.length > 0) return; // already checked
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "SpecialistAttendance!A:D",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, branch, categoryId, grade]] },
    });
    return;
  }

  if (matchingRowNums.length === 0) return; // already unchecked
  const sheetId = await getSheetIdByTitle(sheets, "SpecialistAttendance");
  matchingRowNums.sort((a, b) => b - a); // highest index first, see clearAttendance
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: matchingRowNums.map((rowNum) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNum - 1,
            endIndex: rowNum,
          },
        },
      })),
    },
  });
}

/**
 * Every checked cell ever recorded for one grade within a branch, no date
 * bound — used by the end-of-term Reset backup export. Categories are
 * branch-wide (shared across all 3 grades), so this only ever reads the
 * one grade being reset, never touching the other two.
 */
export async function getAllSpecialistAttendanceForGrade(
  branch: string,
  grade: string
): Promise<SpecialistCheckedCell[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistAttendance!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      branch: (row[1] ?? "").toString(),
      categoryId: (row[2] ?? "").toString(),
      grade: (row[3] ?? "").toString(),
    }))
    .filter((r) => r.branch === branch && r.grade === grade && r.categoryId)
    .map((r) => ({ categoryId: r.categoryId, grade: r.grade, date: r.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Deletes every checked cell for one grade within a branch, regardless of
 * date or category — the "Coach Schedule" half of the end-of-term Reset.
 * Not recoverable, unlike the student roster's soft-delete, which is why
 * the caller must only run this after the backup export has already
 * succeeded. Returns how many rows were removed, for the confirmation UI.
 */
export async function deleteSpecialistAttendanceForGrade(
  branch: string,
  grade: string
): Promise<number> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistAttendance!A2:D",
  });
  const rows = res.data.values ?? [];
  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => (row[1] ?? "") === branch && (row[3] ?? "") === grade)
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return 0;

  const sheetId = await getSheetIdByTitle(sheets, "SpecialistAttendance");
  rowNums.sort((a, b) => b - a); // highest index first, see clearAttendance
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      })),
    },
  });
  return rowNums.length;
}

// 専門コーチ参加人数 — a separate daily record (distinct from the
// checklist above) of how many kids actually joined each 専門コーチ
// category that day, out of however many attended school. Rows share
// SpecialistCategories, keyed the same way as SpecialistAttendance but
// carry a count instead of just existing.
export type SpecialistParticipationCell = {
  categoryId: string;
  grade: string; // "長" | "中" | "少"
  date: string; // "YYYY-MM-DD"
  count: number;
};

export async function getSpecialistParticipation(
  branch: string,
  yearMonth: string // "2026-08"
): Promise<SpecialistParticipationCell[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistParticipation!A2:E",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      branch: (row[1] ?? "").toString(),
      categoryId: (row[2] ?? "").toString(),
      grade: (row[3] ?? "").toString(),
      count: Number(row[4] ?? 0),
    }))
    .filter(
      (r) =>
        r.branch === branch &&
        r.date.startsWith(yearMonth) &&
        r.categoryId &&
        Number.isFinite(r.count)
    )
    .map((r) => ({
      categoryId: r.categoryId,
      grade: r.grade,
      date: r.date,
      count: r.count,
    }));
}

/**
 * Set (or clear, with count === null) a day's participant count for one
 * category+grade. Same defensive "delete every matching row, not just the
 * first" shape as clearAttendance/setSpecialistChecked.
 */
export async function setSpecialistParticipationCount(
  branch: string,
  categoryId: string,
  grade: string,
  date: string,
  count: number | null
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistParticipation!A2:E",
  });
  const rows = existing.data.values ?? [];
  const matchingRowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(
      ({ row }) =>
        (row[0] ?? "") === date &&
        (row[1] ?? "") === branch &&
        (row[2] ?? "") === categoryId &&
        (row[3] ?? "") === grade
    )
    .map(({ rowNum }) => rowNum);

  if (count !== null) {
    if (matchingRowNums.length > 0) {
      // update the first, delete any stray extras
      const [keep, ...extra] = matchingRowNums;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `SpecialistParticipation!E${keep}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[count]] },
      });
      if (extra.length > 0) {
        const sheetId = await getSheetIdByTitle(sheets, "SpecialistParticipation");
        extra.sort((a, b) => b - a);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: extra.map((rowNum) => ({
              deleteDimension: {
                range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
              },
            })),
          },
        });
      }
      return;
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "SpecialistParticipation!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, branch, categoryId, grade, count]] },
    });
    return;
  }

  if (matchingRowNums.length === 0) return; // already cleared
  const sheetId = await getSheetIdByTitle(sheets, "SpecialistParticipation");
  matchingRowNums.sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: matchingRowNums.map((rowNum) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      })),
    },
  });
}

/** Same shape as getAllSpecialistAttendanceForGrade, for the headcount sheet. */
export async function getAllSpecialistParticipationForGrade(
  branch: string,
  grade: string
): Promise<SpecialistParticipationCell[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistParticipation!A2:E",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      branch: (row[1] ?? "").toString(),
      categoryId: (row[2] ?? "").toString(),
      grade: (row[3] ?? "").toString(),
      count: Number(row[4] ?? 0),
    }))
    .filter(
      (r) => r.branch === branch && r.grade === grade && r.categoryId && Number.isFinite(r.count)
    )
    .map((r) => ({ categoryId: r.categoryId, grade: r.grade, date: r.date, count: r.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Same shape/reasoning as deleteSpecialistAttendanceForGrade, for the headcount sheet. */
export async function deleteSpecialistParticipationForGrade(
  branch: string,
  grade: string
): Promise<number> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "SpecialistParticipation!A2:E",
  });
  const rows = res.data.values ?? [];
  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => (row[1] ?? "") === branch && (row[3] ?? "") === grade)
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return 0;

  const sheetId = await getSheetIdByTitle(sheets, "SpecialistParticipation");
  rowNums.sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      })),
    },
  });
  return rowNums.length;
}

// 外出記録 — a free-form log of the class going out somewhere (not tied
// to 専門コーチ's fixed category list; could be anything, and a class can
// log more than one outing on the same day). Each entry is its own row,
// keyed by a UUID rather than date+student like everything else, since
// there's no natural single-cell-per-day shape here.
export type OutingLog = {
  id: string;
  date: string; // "YYYY-MM-DD"
  className: string;
  headcount: number;
  departureTime: string; // "HH:MM" (退室時間)
  departureSign: string; // name of whoever confirmed the departure (退室確認サイン)
  returnTime: string; // "HH:MM" (入室時間), "" until they're back
  returnSign: string; // name of whoever confirmed the return (入室確認サイン), "" until they're back
  description: string; // free text, optional — where/what
};

export async function getOutingLogs(
  className: string,
  yearMonth: string // "2026-08"
): Promise<OutingLog[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "OutingLog!A2:J",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      id: (row[0] ?? "").toString(),
      date: (row[1] ?? "").toString(),
      className: (row[2] ?? "").toString(),
      headcount: Number(row[3] ?? 0),
      departureTime: (row[4] ?? "").toString(),
      departureSign: (row[5] ?? "").toString(),
      returnTime: (row[6] ?? "").toString(),
      returnSign: (row[7] ?? "").toString(),
      description: (row[8] ?? "").toString(),
    }))
    .filter(
      (r) => r.id && r.className === className && r.date.startsWith(yearMonth)
    )
    .sort((a, b) => (a.date + a.departureTime).localeCompare(b.date + b.departureTime));
}

export async function addOutingLog(entry: OutingLog): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "OutingLog!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          entry.id,
          entry.date,
          entry.className,
          entry.headcount,
          entry.departureTime,
          entry.departureSign,
          entry.returnTime,
          entry.returnSign,
          entry.description,
          new Date().toISOString(),
        ],
      ],
    },
  });
}

/** Replaces every editable field of an entry at once (a full form save, not a partial patch). */
export async function updateOutingLog(
  id: string,
  fields: Omit<OutingLog, "id">
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "OutingLog!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;

  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `OutingLog!B${rowNum}:J${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          fields.date,
          fields.className,
          fields.headcount,
          fields.departureTime,
          fields.departureSign,
          fields.returnTime,
          fields.returnSign,
          fields.description,
          new Date().toISOString(),
        ],
      ],
    },
  });
}

export async function deleteOutingLog(id: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "OutingLog!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => (row[0] ?? "") === id)
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return;

  const sheetId = await getSheetIdByTitle(sheets, "OutingLog");
  rowNums.sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      })),
    },
  });
}

// 外出先の登録リスト — a manageable list of common outing destinations,
// separate from OutingLog itself. School-wide (not per-branch) since both
// branches are close together and go to the same places. Deliberately
// unrelated to SpecialistCategories — those are coach activities, not
// destinations, and stay their own separate concept.
export type OutingDestination = {
  id: string;
  name: string;
};

export async function getOutingDestinations(): Promise<OutingDestination[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "OutingDestinations!A2:B",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({ id: (row[0] ?? "").toString(), name: (row[1] ?? "").toString() }))
    .filter((d) => d.id && d.name);
}

export async function addOutingDestination(id: string, name: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "OutingDestinations!A:B",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id, name]] },
  });
}

export async function deleteOutingDestination(id: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "OutingDestinations!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;

  const sheetId = await getSheetIdByTitle(sheets, "OutingDestinations");
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
          },
        },
      ],
    },
  });
}

// 送迎表 — daily 登園 (arrival) / 降園 (departure) time per student, for
// the whole-branch 送迎管理 roster. One row per date+student, same
// upsert-in-place shape as Attendance so re-saving a day never
// accumulates duplicate rows.
export type PickupRecord = {
  date: string; // "YYYY-MM-DD"
  studentId: string;
  arrivalTime: string; // "HH:MM", "" if not recorded yet
  departureTime: string; // "HH:MM", "" if not recorded yet
};

/** Every PickupLog row for a given month, across all students/branches — callers filter to their branch's studentIds. */
export async function getPickupRecordsForMonth(yearMonth: string): Promise<PickupRecord[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "PickupLog!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row): PickupRecord => ({
      date: (row[0] ?? "").toString(),
      studentId: (row[1] ?? "").toString(),
      arrivalTime: (row[2] ?? "").toString(),
      departureTime: (row[3] ?? "").toString(),
    }))
    .filter((r) => r.date.startsWith(yearMonth) && r.studentId);
}

/**
 * Set one student's 登園/降園 time for one day. Only the field(s) passed
 * are changed — passing just arrivalTime leaves an existing departureTime
 * (or vice versa) alone, since the two are usually recorded hours apart.
 */
export async function upsertPickupRecord(
  date: string,
  studentId: string,
  fields: { arrivalTime?: string; departureTime?: string }
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "PickupLog!A2:D",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex(
    (row) => (row[0] ?? "") === date && (row[1] ?? "") === studentId
  );

  // RAW (not USER_ENTERED) specifically for the time columns — Sheets'
  // auto-parsing recognizes "08:15" as a time value and re-serializes it
  // without the leading zero ("8:15") on read, silently corrupting the
  // format. RAW stores the literal string, no interpretation.
  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "PickupLog!A:D",
      valueInputOption: "RAW",
      requestBody: {
        values: [[date, studentId, fields.arrivalTime ?? "", fields.departureTime ?? ""]],
      },
    });
    return;
  }

  const rowNum = rowOffset + 2;
  const current = rows[rowOffset];
  const nextArrival = fields.arrivalTime ?? current[2] ?? "";
  const nextDeparture = fields.departureTime ?? current[3] ?? "";
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `PickupLog!C${rowNum}:D${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [[nextArrival, nextDeparture]] },
  });
}

// カレンダー管理 — school-wide holiday master list (date + optional label,
// e.g. "Songkran"), viewed all 12 months of a fiscal year at once. Every
// class's own calendar shows these as its default, but can independently
// override any date (see ClassCalendarOverrides below) — 送迎管理 aside,
// this is the only other school-wide (not per-class) piece of data.
export type MasterHoliday = {
  date: string; // "YYYY-MM-DD"
  label: string;
};

export async function getMasterHolidays(): Promise<MasterHoliday[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "MasterHolidays!A2:B",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({ date: (row[0] ?? "").toString(), label: (row[1] ?? "").toString() }))
    .filter((h) => h.date);
}

/** label === null removes the date from the holiday list entirely; a string (even "") sets/updates it as a holiday. */
export async function setMasterHoliday(date: string, label: string | null): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "MasterHolidays!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === date);

  if (label === null) {
    if (rowOffset === -1) return; // already not a holiday
    const sheetId = await getSheetIdByTitle(sheets, "MasterHolidays");
    const rowNum = rowOffset + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            },
          },
        ],
      },
    });
    return;
  }

  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "MasterHolidays!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date, label]] },
    });
    return;
  }
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `MasterHolidays!B${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[label]] },
  });
}

/** Deletes every Master holiday. Returns how many rows were removed. */
export async function clearAllMasterHolidays(): Promise<number> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "MasterHolidays!A2:A",
  });
  const rows = existing.data.values ?? [];
  if (rows.length === 0) return 0;

  const sheetId = await getSheetIdByTitle(sheets, "MasterHolidays");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 1 + rows.length },
          },
        },
      ],
    },
  });
  return rows.length;
}

// Google publishes a public read-only "Holidays in Thailand" calendar as an
// ICS feed — no auth needed. Used for a one-time bulk import into
// MasterHolidays; the admin edits/removes individual days afterward for
// ones the school doesn't actually close for.
const THAI_HOLIDAYS_ICS_URL =
  "https://calendar.google.com/calendar/ical/en.th%23holiday%40group.v.calendar.google.com/public/basic.ics";

function parseIcsHolidays(icsText: string): { date: string; label: string }[] {
  // Unfold ICS line continuations (a line starting with a space/tab is a
  // continuation of the previous line) before splitting into lines.
  const unfolded = icsText.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");

  const events: { date: string; label: string }[] = [];
  let current: { date?: string; label?: string } | null = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = {};
    } else if (line.startsWith("END:VEVENT")) {
      if (current?.date) events.push({ date: current.date, label: current.label ?? "" });
      current = null;
    } else if (current) {
      if (line.startsWith("DTSTART")) {
        const m = line.match(/(\d{8})$/);
        if (m) {
          const raw = m[1];
          current.date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        }
      } else if (line.startsWith("SUMMARY:")) {
        current.label = line.slice("SUMMARY:".length).replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
      }
    }
  }
  return events;
}

/**
 * One-time bulk import of Thai public holidays into MasterHolidays. Only
 * adds dates not already present — never overwrites an existing (possibly
 * hand-edited) holiday, so it's safe to re-run.
 */
export async function importThaiHolidays(): Promise<{ added: number; skipped: number }> {
  const res = await fetch(THAI_HOLIDAYS_ICS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Thai holidays feed: ${res.status}`);
  const icsText = await res.text();
  const events = parseIcsHolidays(icsText);

  const existingDates = new Set((await getMasterHolidays()).map((h) => h.date));
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const e of events) {
    if (existingDates.has(e.date) || seen.has(e.date)) continue;
    seen.add(e.date);
    rows.push([e.date, e.label]);
  }

  if (rows.length > 0) {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "MasterHolidays!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  }

  return { added: rows.length, skipped: events.length - rows.length };
}

// Per-class open/closed overrides — only a row when a class's calendar
// actually DIFFERS from the Master default for that date (forcing open on
// a Master holiday, e.g. a make-up class, or forcing closed on an
// otherwise-normal day). No row for a date means "use the Master default."
export type ClassCalendarOverride = {
  className: string;
  date: string;
  isOpen: boolean;
  /** Only meaningful when isOpen is false — this class's own name for the closure. */
  label?: string;
};

export async function getClassCalendarOverrides(
  className: string
): Promise<ClassCalendarOverride[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ClassCalendarOverrides!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((row) => (row[0] ?? "") === className)
    .map((row) => ({
      className: (row[0] ?? "").toString(),
      date: (row[1] ?? "").toString(),
      isOpen: (row[2] ?? "").toString().toUpperCase() === "TRUE",
      label: (row[3] ?? "").toString() || undefined,
    }))
    .filter((o) => o.date);
}

/** isOpen === null removes the override (falls back to the Master default again). */
export async function setClassCalendarOverride(
  className: string,
  date: string,
  isOpen: boolean | null,
  label?: string
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ClassCalendarOverrides!A2:B",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex(
    (row) => (row[0] ?? "") === className && (row[1] ?? "") === date
  );

  if (isOpen === null) {
    if (rowOffset === -1) return; // no override to remove
    const sheetId = await getSheetIdByTitle(sheets, "ClassCalendarOverrides");
    const rowNum = rowOffset + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            },
          },
        ],
      },
    });
    return;
  }

  const labelValue = isOpen === false ? (label ?? "") : "";

  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "ClassCalendarOverrides!A:D",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[className, date, isOpen ? "TRUE" : "FALSE", labelValue]] },
    });
    return;
  }
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `ClassCalendarOverrides!C${rowNum}:D${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[isOpen ? "TRUE" : "FALSE", labelValue]] },
  });
}

// 欠席理由リスト — the quick-pick buttons on the check-in page and the
// Dashboard's edit popup (都合欠/病欠/インフルエンザ/...). School-wide, like
// MasterHolidays. Deleting an option only removes it from the picker; it
// never touches already-recorded Attendance rows, which store the reason
// as plain text independent of this list. "その他" (free text) is always
// available in the UI regardless of what's here, so this list is never a
// hard constraint on what can be recorded.
export type AbsenceReason = {
  id: string;
  label: string;
  en: string;
  status: "absent" | "suspended";
};

export async function getAbsenceReasons(): Promise<AbsenceReason[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "AbsenceReasons!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      id: (row[0] ?? "").toString(),
      label: (row[1] ?? "").toString(),
      en: (row[2] ?? "").toString(),
      status: ((row[3] ?? "").toString() === "suspended" ? "suspended" : "absent") as
        | "absent"
        | "suspended",
    }))
    .filter((r) => r.id && r.label);
}

export async function addAbsenceReason(
  id: string,
  reason: Omit<AbsenceReason, "id">
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "AbsenceReasons!A:D",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id, reason.label, reason.en, reason.status]] },
  });
}

export async function updateAbsenceReason(
  id: string,
  updates: Partial<Omit<AbsenceReason, "id">>
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "AbsenceReasons!A2:D",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const rowNum = rowOffset + 2;
  const current = rows[rowOffset];
  const merged = [
    id,
    updates.label ?? (current[1] ?? ""),
    updates.en ?? (current[2] ?? ""),
    updates.status ?? (current[3] ?? "absent"),
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `AbsenceReasons!A${rowNum}:D${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [merged] },
  });
}

export async function deleteAbsenceReason(id: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "AbsenceReasons!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const sheetId = await getSheetIdByTitle(sheets, "AbsenceReasons");
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
          },
        },
      ],
    },
  });
}

// クラス管理 — classes OUTSIDE the fixed 年少/年中/年長 continuum (like
// トンロー　小学生). The continuum itself stays hardcoded in classes.ts
// (専門コーチ scoping, promotion logic, etc. all depend on that exact
// shape) — only these "extra" classes are Master-manageable. Full class
// name is always `${branch}　${suffix}`, matching the existing naming
// convention. "active: false" hides a class everywhere (top page, etc.)
// without touching its historical Students/Attendance/... data — same
// soft-delete philosophy as a student's own active flag.
export type ExtraClass = {
  id: string;
  branch: "プロンポン" | "トンロー";
  suffix: string;
  nameEn: string;
  active: boolean;
};

export async function getExtraClasses(): Promise<ExtraClass[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ExtraClasses!A2:E",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      id: (row[0] ?? "").toString(),
      branch: ((row[1] ?? "").toString() === "トンロー" ? "トンロー" : "プロンポン") as
        | "プロンポン"
        | "トンロー",
      suffix: (row[2] ?? "").toString(),
      nameEn: (row[3] ?? "").toString(),
      active: (row[4] ?? "").toString().toUpperCase() !== "FALSE",
    }))
    .filter((c) => c.id && c.suffix);
}

export async function addExtraClass(id: string, data: Omit<ExtraClass, "id">): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "ExtraClasses!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[id, data.branch, data.suffix, data.nameEn, data.active ? "TRUE" : "FALSE"]],
    },
  });
}

export async function updateExtraClass(
  id: string,
  updates: Partial<Omit<ExtraClass, "id">>
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "ExtraClasses!A2:E",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const rowNum = rowOffset + 2;
  const current = rows[rowOffset];
  const currentActive = (current[4] ?? "TRUE").toString().toUpperCase() !== "FALSE";
  const nextActive = updates.active ?? currentActive;
  const merged = [
    id,
    updates.branch ?? (current[1] ?? "プロンポン"),
    updates.suffix ?? (current[2] ?? ""),
    updates.nameEn ?? (current[3] ?? ""),
    nextActive ? "TRUE" : "FALSE",
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `ExtraClasses!A${rowNum}:E${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [merged] },
  });
}

/**
 * Permanently removes an extra class -- only allowed once it's already
 * inactive (deactivate-first-then-delete is the safety funnel; the UI
 * enforces this too). This only removes the class from ExtraClasses, i.e.
 * it stops being selectable anywhere; any historical Students/Attendance/
 * StudentLocations/etc. rows that used its class name are NOT touched or
 * cleaned up -- they simply become unreachable through the app (still sit
 * in their sheets, viewable only by opening the spreadsheet directly).
 * Throws if the class is still active, so callers can't skip the funnel.
 */
export async function deleteExtraClass(id: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "ExtraClasses!A2:E",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const isActive = (rows[rowOffset][4] ?? "TRUE").toString().toUpperCase() !== "FALSE";
  if (isActive) {
    throw new Error("Class must be deactivated before it can be permanently deleted");
  }
  const sheetId = await getSheetIdByTitle(sheets, "ExtraClasses");
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
          },
        },
      ],
    },
  });
}

// バス管理 — a plain named list (school-wide), each with an optional emoji
// icon for quick visual identification. Not yet wired into 送迎管理 or
// anywhere else; this is just the Master list itself.
export type Bus = {
  id: string;
  name: string;
  emoji: string;
};

export async function getBuses(): Promise<Bus[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Buses!A2:C",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      id: (row[0] ?? "").toString(),
      name: (row[1] ?? "").toString(),
      emoji: (row[2] ?? "").toString(),
    }))
    .filter((b) => b.id && b.name);
}

export async function addBus(id: string, bus: Omit<Bus, "id">): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Buses!A:C",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id, bus.name, bus.emoji]] },
  });
}

export async function updateBus(id: string, updates: Partial<Omit<Bus, "id">>): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Buses!A2:C",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const rowNum = rowOffset + 2;
  const current = rows[rowOffset];
  const merged = [id, updates.name ?? (current[1] ?? ""), updates.emoji ?? (current[2] ?? "")];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Buses!A${rowNum}:C${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [merged] },
  });
}

export async function deleteBus(id: string): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "Buses!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === id);
  if (rowOffset === -1) return;
  const sheetId = await getSheetIdByTitle(sheets, "Buses");
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
          },
        },
      ],
    },
  });
}

// 送迎バスルート計算 — each student's geocoded home address, feeding the
// per-bus route optimizer. Deliberately its own sheet (not extra columns
// on Students) since it's optional per-student data unrelated to
// attendance, and this keeps the heavily-used Students sheet/functions
// untouched. Geocoding itself happens server-side (Nominatim, OpenStreetMap
// — no paid API, see /api/students/location) so this just stores the result.
export type StudentLocation = {
  studentId: string;
  address: string;
  lat: number;
  lng: number;
};

export async function getStudentLocations(): Promise<StudentLocation[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "StudentLocations!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      studentId: (row[0] ?? "").toString(),
      address: (row[1] ?? "").toString(),
      lat: Number(row[2] ?? 0),
      lng: Number(row[3] ?? 0),
    }))
    .filter((l) => l.studentId && l.address);
}

export async function getStudentLocation(studentId: string): Promise<StudentLocation | null> {
  const all = await getStudentLocations();
  return all.find((l) => l.studentId === studentId) ?? null;
}

/** location === null removes the saved address for this student. */
export async function setStudentLocation(
  studentId: string,
  location: { address: string; lat: number; lng: number } | null
): Promise<void> {
  const sheets = getSheetsClient();
  const existing2 = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "StudentLocations!A2:A",
  });
  const rows2 = existing2.data.values ?? [];
  const rowOffset2 = rows2.findIndex((row) => (row[0] ?? "") === studentId);

  if (location === null) {
    if (rowOffset2 === -1) return;
    const sheetId2 = await getSheetIdByTitle(sheets, "StudentLocations");
    const rowNum2 = rowOffset2 + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId: sheetId2, dimension: "ROWS", startIndex: rowNum2 - 1, endIndex: rowNum2 },
            },
          },
        ],
      },
    });
    return;
  }

  const values = [[studentId, location.address, location.lat, location.lng]];
  if (rowOffset2 === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "StudentLocations!A:D",
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return;
  }
  const rowNum2 = rowOffset2 + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `StudentLocations!A${rowNum2}:D${rowNum2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

// 送迎バス - 通学方法 — whether a student rides the bus or is dropped
// off/picked up by their own parents. Kept separate from StudentLocations
// (a "self" student has no address at all, and this is a different concern
// from the address itself) and from Students (same reasoning as
// StudentLocations — optional, unrelated to attendance, keeps the
// heavily-used Students sheet/functions untouched).
export type TransportMode = "bus" | "self";
export type StudentTransport = { studentId: string; mode: TransportMode };

export async function getStudentTransports(): Promise<StudentTransport[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "StudentTransport!A2:B",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      studentId: (row[0] ?? "").toString(),
      mode: ((row[1] ?? "").toString() === "self" ? "self" : "bus") as TransportMode,
    }))
    .filter((t) => t.studentId);
}

export async function getStudentTransport(studentId: string): Promise<StudentTransport | null> {
  const all = await getStudentTransports();
  return all.find((t) => t.studentId === studentId) ?? null;
}

/** mode === null clears the setting (back to "not yet chosen"). */
export async function setStudentTransport(
  studentId: string,
  mode: TransportMode | null
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets,{
    spreadsheetId: SHEET_ID,
    range: "StudentTransport!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === studentId);

  if (mode === null) {
    if (rowOffset === -1) return;
    const sheetId = await getSheetIdByTitle(sheets, "StudentTransport");
    const rowNum = rowOffset + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            },
          },
        ],
      },
    });
    return;
  }

  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "StudentTransport!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[studentId, mode]] },
    });
    return;
  }
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `StudentTransport!B${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[mode]] },
  });
}

// 月次バスパターン — bus students can ride the bus one way and be picked up/
// dropped off themselves the other way, and which of the 3 combinations
// applies changes month to month (school activities, parent schedules,
// etc.). Only meaningful for students whose overall StudentTransport mode
// is "bus" -- this is layered on top of that, not a replacement for it.
// One row per (studentId, yearMonth) -- but ONLY for months that deviate
// from the default 来:バス／帰:バス (full round-trip bus), which is assumed
// whenever no row exists for that student+month. This keeps the sheet to
// just the exceptions while still preserving full month-by-month history
// for every month someone actually changed it.
export type BusLegMode = "bus" | "self";
export type StudentBusPattern = {
  studentId: string;
  yearMonth: string; // "YYYY-MM"
  arrivalMode: BusLegMode;
  departureMode: BusLegMode;
};

function parseBusLegMode(raw: string | undefined): BusLegMode {
  return (raw ?? "").toString() === "self" ? "self" : "bus";
}

/** Every recorded (non-default) pattern for one month, across all students. */
export async function getBusPatternsForMonth(yearMonth: string): Promise<StudentBusPattern[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "StudentBusPattern!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row): StudentBusPattern => ({
      studentId: (row[0] ?? "").toString(),
      yearMonth: (row[1] ?? "").toString(),
      arrivalMode: parseBusLegMode(row[2]),
      departureMode: parseBusLegMode(row[3]),
    }))
    .filter((p) => p.studentId && p.yearMonth === yearMonth);
}

/** Every recorded (non-default) month for one student, oldest first --
 *  the month-by-month history view (defaults/unset months aren't included,
 *  since they're implicitly 来:バス／帰:バス). */
export async function getBusPatternHistory(studentId: string): Promise<StudentBusPattern[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "StudentBusPattern!A2:D",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row): StudentBusPattern => ({
      studentId: (row[0] ?? "").toString(),
      yearMonth: (row[1] ?? "").toString(),
      arrivalMode: parseBusLegMode(row[2]),
      departureMode: parseBusLegMode(row[3]),
    }))
    .filter((p) => p.studentId === studentId)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
}

/**
 * Sets one student's pattern for one month. Setting it back to the default
 * (bus/bus) deletes the row instead of storing it -- functionally identical
 * either way (a missing row already means "default"), and keeps the sheet
 * limited to genuine exceptions.
 */
export async function setBusPattern(
  studentId: string,
  yearMonth: string,
  arrivalMode: BusLegMode,
  departureMode: BusLegMode
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "StudentBusPattern!A2:B",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex(
    (row) => (row[0] ?? "") === studentId && (row[1] ?? "") === yearMonth
  );
  const isDefault = arrivalMode === "bus" && departureMode === "bus";

  if (isDefault) {
    if (rowOffset === -1) return; // already default, nothing stored to remove
    const sheetId = await getSheetIdByTitle(sheets, "StudentBusPattern");
    const rowNum = rowOffset + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            },
          },
        ],
      },
    });
    return;
  }

  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "StudentBusPattern!A:D",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[studentId, yearMonth, arrivalMode, departureMode]] },
    });
    return;
  }
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `StudentBusPattern!C${rowNum}:D${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[arrivalMode, departureMode]] },
  });
}

// クラスカラー — an optional color per class (both the fixed continuum and
// Master-managed extra classes), purely cosmetic: which button color shows
// on the top page. `color` is a key into a small curated palette (see
// CLASS_COLOR_STYLES in select-class/page.tsx) rather than a free hex
// value, since Tailwind's build-time scanner needs literal class name
// strings in the source to generate their CSS -- a value straight from the
// sheet couldn't be turned into working Tailwind classes at runtime.
export type ClassColor = { className: string; color: string };

export async function getClassColors(): Promise<ClassColor[]> {
  const sheets = getSheetsClient();
  const res = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "ClassColors!A2:B",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((row) => ({
      className: (row[0] ?? "").toString(),
      color: (row[1] ?? "").toString(),
    }))
    .filter((c) => c.className && c.color);
}

/** color === null resets the class back to the default (no color chosen). */
export async function setClassColor(className: string, color: string | null): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await safeValuesGet(sheets, {
    spreadsheetId: SHEET_ID,
    range: "ClassColors!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === className);

  if (color === null) {
    if (rowOffset === -1) return;
    const sheetId = await getSheetIdByTitle(sheets, "ClassColors");
    const rowNum = rowOffset + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
            },
          },
        ],
      },
    });
    return;
  }

  if (rowOffset === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "ClassColors!A:B",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[className, color]] },
    });
    return;
  }
  const rowNum = rowOffset + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `ClassColors!B${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[color]] },
  });
}
