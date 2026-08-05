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

export type Student = {
  studentId: string;
  nameKanji: string;
  nameFurigana: string;
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
      nameFurigana: row[2] ?? "",
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
          student.nameFurigana,
          student.className,
          "TRUE",
        ],
      ],
    },
  });
}

/** Append attendance rows (one per student) for a given day/class. */
export async function submitAttendance(records: AttendanceRecord[]): Promise<void> {
  if (records.length === 0) return;

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Attendance!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: records.map((r) => [
        r.date,
        r.className,
        r.studentId,
        r.present ? "TRUE" : "FALSE",
        r.timestamp,
      ]),
    },
  });
}
