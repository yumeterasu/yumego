const fs = require("fs");
function loadEnv(envPath) {
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv("C:/Users/Admin/Desktop/Yumego/myapp/.env.local");

const BASE = "https://yumego.vercel.app";
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("Waiting for Vercel deploy...");
  await sleep(40000);
  const password = process.env.APP_PASSWORD;
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "application/json" };

  const BRANCH = "プロンポン";
  const res = await fetch(`${BASE}/api/pickup?branch=${encodeURIComponent(BRANCH)}&month=2026-08`, { headers });
  console.log("GET status:", res.status);
  if (!res.ok) throw new Error("GET failed");
  const data = await res.json();
  console.log("Students returned:", data.students.length);
  console.log("Classes represented:", [...new Set(data.students.map((s) => s.className))]);
  console.log("Existing records this month:", data.records.length);

  const testStudent = data.students[0];
  console.log("\nTesting with:", testStudent.nameKanji, testStudent.studentId);

  const DATE = "2026-08-21";
  const patchRes = await fetch(`${BASE}/api/pickup`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ date: DATE, studentId: testStudent.studentId, arrivalTime: "08:15" }),
  });
  console.log("PATCH arrival status:", patchRes.status);
  if (!patchRes.ok) throw new Error("PATCH failed");

  const patchRes2 = await fetch(`${BASE}/api/pickup`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ date: DATE, studentId: testStudent.studentId, departureTime: "15:30" }),
  });
  console.log("PATCH departure status:", patchRes2.status);
  if (!patchRes2.ok) throw new Error("PATCH 2 failed");

  const verifyRes = await fetch(`${BASE}/api/pickup?branch=${encodeURIComponent(BRANCH)}&month=2026-08`, { headers });
  const verifyData = await verifyRes.json();
  const record = verifyData.records.find((r) => r.studentId === testStudent.studentId && r.date === DATE);
  console.log("\nRecord after both PATCHes:", record);
  if (!record || record.arrivalTime !== "08:15" || record.departureTime !== "15:30") {
    throw new Error("record did not save both fields correctly");
  }

  // Clean up — clear both fields back to blank, leaving no test residue.
  await fetch(`${BASE}/api/pickup`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ date: DATE, studentId: testStudent.studentId, arrivalTime: "", departureTime: "" }),
  });
  const finalRes = await fetch(`${BASE}/api/pickup?branch=${encodeURIComponent(BRANCH)}&month=2026-08`, { headers });
  const finalData = await finalRes.json();
  const finalRecord = finalData.records.find((r) => r.studentId === testStudent.studentId && r.date === DATE);
  console.log("Record after cleanup (expect blank times):", finalRecord);

  // Page reachability
  const pageRes = await fetch(`${BASE}/dashboard/pickup?branch=${encodeURIComponent(BRANCH)}`, { headers });
  console.log("\n/dashboard/pickup page status:", pageRes.status);

  const badRes = await fetch(`${BASE}/api/pickup?branch=${encodeURIComponent(BRANCH)}`, { headers });
  console.log("Missing month -> status (expect 400):", badRes.status);

  console.log("\n✅ Pickup management feature works end-to-end, cleaned up after itself.");
}
main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});
