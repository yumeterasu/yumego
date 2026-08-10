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
  /** Generic, meaning-free checkboxes (チェック1/2/3) — up to the teacher. */
  check1: boolean;
  check2: boolean;
  check3: boolean;
};

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
  /** Free-text detail, e.g. which of 事故欠/病欠/インフルエンザ/... this is. */
  reason: string;
};

/** Read all students for a given class (active only). */
export async function getStudentsByClass(className: string): Promise<Student[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Students!A2:I",
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
      check1: (row[6] ?? "").toString().toUpperCase() === "TRUE",
      check2: (row[7] ?? "").toString().toUpperCase() === "TRUE",
      check3: (row[8] ?? "").toString().toUpperCase() === "TRUE",
    }))
    .filter((s) => s.studentId && s.className === className && s.active);
}

/** Append a new student row to the Students sheet. */
export async function addStudent(
  student: Omit<Student, "active" | "remark" | "check1" | "check2" | "check3">
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Students!A:I",
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
          "FALSE",
          "FALSE",
          "FALSE",
        ],
      ],
    },
  });
}

async function findStudentRowNumber(
  sheets: ReturnType<typeof getSheetsClient>,
  studentId: string
): Promise<number | null> {
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Students!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === studentId);
  return rowOffset === -1 ? null : rowOffset + 2; // 1-based, +1 for header
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
    range: "Attendance!A2:F",
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
  const res = await sheets.spreadsheets.values.get({
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
  const res = await sheets.spreadsheets.values.get({
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
  const existing = await sheets.spreadsheets.values.get({
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

// Per-class custom labels for the 3 generic checkbox columns (チェック1/2/3).
export type ClassCheckLabels = {
  check1Label: string;
  check2Label: string;
  check3Label: string;
};

const CHECK_LABEL_COLUMN_LETTERS: Record<keyof ClassCheckLabels, string> = {
  check1Label: "B",
  check2Label: "C",
  check3Label: "D",
};

/** Read a class's custom checkbox column labels (blank strings if unset). */
export async function getClassCheckLabels(
  className: string
): Promise<ClassCheckLabels> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "ClassSettings!A2:D",
  });
  const rows = res.data.values ?? [];
  const row = rows.find((r) => (r[0] ?? "") === className);
  return {
    check1Label: row?.[1] ?? "",
    check2Label: row?.[2] ?? "",
    check3Label: row?.[3] ?? "",
  };
}

/** Set one of a class's custom checkbox column labels. */
export async function updateClassCheckLabel(
  className: string,
  column: keyof ClassCheckLabels,
  label: string
): Promise<void> {
  const sheets = getSheetsClient();
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "ClassSettings!A2:A",
  });
  const rows = existing.data.values ?? [];
  const rowOffset = rows.findIndex((row) => (row[0] ?? "") === className);

  const colLetter = CHECK_LABEL_COLUMN_LETTERS[column];

  if (rowOffset === -1) {
    // no row for this class yet — append one
    const values =
      column === "check1Label"
        ? [className, label, "", ""]
        : column === "check2Label"
          ? [className, "", label, ""]
          : [className, "", "", label];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "ClassSettings!A:D",
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
  const res = await sheets.spreadsheets.values.get({
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
  const existing = await sheets.spreadsheets.values.get({
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
  const existing = await sheets.spreadsheets.values.get({
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
  const res = await sheets.spreadsheets.values.get({
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
  const existing = await sheets.spreadsheets.values.get({
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
  const res = await sheets.spreadsheets.values.get({
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
  const existing = await sheets.spreadsheets.values.get({
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
