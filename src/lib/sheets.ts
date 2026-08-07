import { google } from "googleapis";

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
};

/** Read all students for a given class (active only). */
export async function getStudentsByClass(className: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Students!A2:F",
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row): Student => ({
      studentId: row[0] ?? "",
      nameKanji: row[1] ?? "",
      nameEnglish: row[2] ?? "",
      className: row[3] ?? "",
      active: (row[4] ?? "").toString().toUpperCase() === "TRUE",
      remark: row[5] ?? "",
    }))
    .filter((s) => s.studentId && s.className === className && s.active);
}

/** Append a new student row to the Students sheet. */
export async function addStudent(
  student: Omit<Student, "active" | "remark">
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Students!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          student.studentId,
          student.nameKanji,
          student.nameEnglish,
          student.className,
          "TRUE",
          "",
        ],
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
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Students!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === studentId);
  if (rowOffset === -1) return;

  const rowNum = rowOffset + 2; // 1-based, +1 for header
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Students!F${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[remark]] },
  });
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:E",
  });

  const rows = res.data.values ?? [];
  const summary: Record<string, number> = {};

  for (const row of rows) {
    const rowDate = (row[0] ?? "").toString();
    if (rowDate !== date) continue;
    const className = (row[1] ?? "").toString();
    if (!className) continue;
    const status = parseStatus((row[3] ?? "").toString());
    if (!(className in summary)) summary[className] = 0;
    if (countsAsPresent(status)) summary[className]++;
  }

  return summary;
}

/** Read every attendance record for a class within a given YYYY-MM month. */
export async function getAttendanceForMonth(
  className: string,
  yearMonth: string // "2026-08"
): Promise<{ date: string; studentId: string; status: AttendanceStatus }[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:E",
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row) => ({
      date: (row[0] ?? "").toString(),
      className: (row[1] ?? "").toString(),
      studentId: (row[2] ?? "").toString(),
      status: parseStatus((row[3] ?? "").toString()),
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.date.startsWith(yearMonth) &&
        r.studentId
    )
    .map((r) => ({ date: r.date, studentId: r.studentId, status: r.status }));
}

/**
 * Read every attendance record for a class within a Japanese school year
 * (April of `fiscalYearStartYear` through March of the following year).
 */
export async function getAttendanceForFiscalYear(
  className: string,
  fiscalYearStartYear: number
): Promise<{ date: string; studentId: string; status: AttendanceStatus }[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:E",
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
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.studentId &&
        r.date >= startDate &&
        r.date <= endDate
    )
    .map((r) => ({ date: r.date, studentId: r.studentId, status: r.status }));
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
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:E",
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
    const values = [[r.date, r.className, r.studentId, r.status, r.timestamp]];
    if (rowNum) {
      updates.push({ range: `Attendance!A${rowNum}:E${rowNum}`, values });
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
      range: "Attendance!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: toAppend.map((r) => [
          r.date,
          r.className,
          r.studentId,
          r.status,
          r.timestamp,
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
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A2:E",
  });
  const rows = existing.data.values ?? [];

  const rowOffset = rows.findIndex(
    (row) => (row[0] ?? "") === date && (row[2] ?? "") === studentId
  );
  if (rowOffset === -1) return; // already blank, nothing to do

  const sheetId = await getSheetIdByTitle(sheets, "Attendance");
  const rowNum = rowOffset + 2; // 1-based, +1 for header

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNum - 1, // 0-based, inclusive
              endIndex: rowNum, // 0-based, exclusive
            },
          },
        },
      ],
    },
  });
}
