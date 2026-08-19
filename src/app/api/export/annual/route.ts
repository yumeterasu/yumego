import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getStudentsByClass,
  getAttendanceForFiscalYear,
  countsAsPresent,
  type AttendanceStatus,
} from "@/lib/sheets";

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

// GET /api/export/annual?class=...&fiscalYear=2026
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const fiscalYearRaw = req.nextUrl.searchParams.get("fiscalYear");
  const fiscalYearStart = fiscalYearRaw ? Number(fiscalYearRaw) : NaN;

  if (!className || !fiscalYearRaw || !Number.isInteger(fiscalYearStart)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'fiscalYear' query params" },
      { status: 400 }
    );
  }

  try {
    const [students, records] = await Promise.all([
      getStudentsByClass(className),
      getAttendanceForFiscalYear(className, fiscalYearStart),
    ]);

    // Collapse to one status per student+date first, same as the on-screen
    // page, so a stray duplicate row never gets double-counted here.
    const dedupedByStudentDate = new Map<string, AttendanceStatus>();
    for (const r of records) {
      dedupedByStudentDate.set(`${r.studentId}|${r.date}`, r.status);
    }

    const counts = new Map<string, number[]>();
    for (const s of students) counts.set(s.studentId, new Array(12).fill(0));

    for (const [key, status] of dedupedByStudentDate) {
      if (!countsAsPresent(status)) continue;
      const [studentId, date] = key.split("|");
      const y = Number(date.slice(0, 4));
      const m = Number(date.slice(5, 7));
      const monthIndex = FISCAL_MONTHS.findIndex(
        (fm) => fm.monthNum === m && fiscalYearStart + fm.yearOffset === y
      );
      if (monthIndex === -1) continue;
      const arr = counts.get(studentId);
      if (arr) arr[monthIndex]++;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`${fiscalYearStart}年度`, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    });

    const headerRow = sheet.addRow([
      "名前",
      ...FISCAL_MONTHS.map((fm, idx) => `${fm.monthNum}月(${MONTH_EN[idx]})`),
      "出席日数",
      "備考",
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });

    students.forEach((s) => {
      const monthCounts = counts.get(s.studentId) ?? new Array(12).fill(0);
      const total = monthCounts.reduce((a, b) => a + b, 0);
      const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;

      const row = sheet.addRow([
        nameCell,
        ...monthCounts.map((c) => (c > 0 ? c : "")),
        total,
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
    });

    sheet.columns = [
      { width: 20 },
      ...FISCAL_MONTHS.map(() => ({ width: 9 })),
      { width: 10 },
      { width: 24 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${className.replace(/\s+/g, "_")}_${fiscalYearStart}年度.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
