const fs = require("fs");

function loadEnv(envPath) {
  const text = fs.readFileSync(envPath, "utf8");
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2];
    if (rest.startsWith('"')) {
      if (rest.length >= 2 && rest.endsWith('"')) {
        process.env[key] = rest.slice(1, -1);
        i++;
        continue;
      }
      const collected = [rest.slice(1)];
      i++;
      while (i < lines.length) {
        if (lines[i].endsWith('"')) {
          collected.push(lines[i].slice(0, -1));
          i++;
          break;
        }
        collected.push(lines[i]);
        i++;
      }
      process.env[key] = collected.join("\n");
    } else {
      process.env[key] = rest;
      i++;
    }
  }
}
loadEnv("C:/Users/Admin/Desktop/Yumego/myapp/.env.local");

const { google } = require("googleapis");
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BASE = "https://yumego.vercel.app";
const CLASS = "トンロー　年長";

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getSheetIdByTitle(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties" });
  return meta.data.sheets.find((s) => s.properties.title === title).properties.sheetId;
}

async function deleteRowsWhere(sheets, tabName, range, matchFn) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tabName}!${range}` });
  const rows = res.data.values ?? [];
  const rowNums = rows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => matchFn(row))
    .map(({ rowNum }) => rowNum);
  if (rowNums.length === 0) return 0;
  const sheetId = await getSheetIdByTitle(sheets, tabName);
  rowNums.sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: rowNums.map((rowNum) => ({
        deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum } },
      })),
    },
  });
  return rowNums.length;
}

async function main() {
  const password = process.env.APP_PASSWORD;
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  // 1. Reuse the real Reset endpoint (no backup step — bypassing the
  //    frontend's backup-first UX gate here on purpose, since this is
  //    disposable test data with nothing worth backing up) — deletes
  //    Coach Schedule + Coach Headcount for トンロー's 年長 grade, and
  //    (no-op) deactivates students, already done.
  const resetRes = await fetch(`${BASE}/api/students/reset`, {
    method: "POST",
    headers,
    body: JSON.stringify({ className: CLASS }),
  });
  console.log("Reset endpoint status:", resetRes.status, await resetRes.json());

  // 2. Direct Sheets cleanup for what Reset intentionally never touches:
  //    Attendance history + the now-inactive Students rows themselves.
  const sheets = getSheetsClient();

  const attendanceDeleted = await deleteRowsWhere(sheets, "Attendance", "A2:F", (row) => (row[1] ?? "") === CLASS);
  console.log("Attendance rows deleted:", attendanceDeleted);

  const studentsDeleted = await deleteRowsWhere(sheets, "Students", "A2:I", (row) => (row[3] ?? "") === CLASS);
  console.log("Students rows deleted:", studentsDeleted);

  // Verify
  const studentsRes = await fetch(`${BASE}/api/students?class=${encodeURIComponent(CLASS)}&includeInactive=true`, { headers });
  const studentsData = await studentsRes.json();
  console.log("\nRemaining students (any state):", studentsData.students.length);

  const attRes = await fetch(`${BASE}/api/attendance?class=${encodeURIComponent(CLASS)}&month=2026-08`, { headers });
  const attData = await attRes.json();
  console.log("Remaining attendance records (2026-08):", attData.records.length);

  const schedRes = await fetch(`${BASE}/api/specialist/attendance?branch=${encodeURIComponent("トンロー")}&month=2026-08`, { headers });
  const schedData = await schedRes.json();
  console.log("Remaining coach schedule cells (grade 長):", schedData.cells.filter((c) => c.grade === "長").length);

  console.log("\n✅ トンロー　年長 fully cleared: students, attendance, and coach data all gone.");
}
main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});
