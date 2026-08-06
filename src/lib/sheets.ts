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
};

export type AttendanceRecord = {
  date: string;
  className: string;
  studentId: string;
  present: boolean;
  timestamp: string;
};

/** Read all students for a given class (active only). */
export async function getStudentsByClass(className: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Students!A2:E",
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row): Student => ({
      studentId: row[0] ?? "",
      nameKanji: row[1] ?? "",
      nameEnglish: row[2] ?? "",
      className: row[3] ?? "",
      active: (row[4] ?? "").toString().toUpperCase() === "TRUE",
    }))
    .filter((s) => s.studentId && s.className === className && s.active);
}

/** Append a new student row to the Students sheet. */
export async function addStudent(student: Omit<Student, "active">): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Students!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          student.studentId,
          student.nameKanji,
          student.nameEnglish,
          student.className,
          "TRUE",
        ],
      ],
    },
  });
}

/** Read every attendance record for a class within a given YYYY-MM month. */
export async function getAttendanceForMonth(
  className: string,
  yearMonth: string // "2026-08"
): Promise<{ date: string; studentId: string; present: boolean }[]> {
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
      present: (row[3] ?? "").toString().toUpperCase() === "TRUE",
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.date.startsWith(yearMonth) &&
        r.studentId
    )
    .map((r) => ({ date: r.date, studentId: r.studentId, present: r.present }));
}

/**
 * Read every attendance record for a class within a Japanese school year
 * (April of `fiscalYearStartYear` through March of the following year).
 */
export async function getAttendanceForFiscalYear(
  className: string,
  fiscalYearStartYear: number
): Promise<{ date: string; studentId: string; present: boolean }[]> {
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
      present: (row[3] ?? "").toString().toUpperCase() === "TRUE",
    }))
    .filter(
      (r) =>
        r.className === className &&
        r.studentId &&
        r.date >= startDate &&
        r.date <= endDate
    )
    .map((r) => ({ date: r.date, studentId: r.studentId, present: r.present }));
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

  const updates: { range: string; values: (string | boolean)[][] }[] = [];
  const toAppend: AttendanceRecord[] = [];

  for (const r of records) {
    const key = `${r.date}|${r.studentId}`;
    const rowNum = rowIndex.get(key);
    const values = [
      [r.date, r.className, r.studentId, r.present ? "TRUE" : "FALSE", r.timestamp],
    ];
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
          r.present ? "TRUE" : "FALSE",
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
