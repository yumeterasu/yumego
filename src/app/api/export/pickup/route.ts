import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getStudentsByBranch, getPickupRecordsForMonth } from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
// Same grouping order as the on-screen 送迎管理 roster.
const CLASS_ORDER = ["年長", "年中", "年少", "小学生"];

function classOrderIndex(className: string) {
  const idx = CLASS_ORDER.findIndex((suffix) => className.endsWith(suffix));
  return idx === -1 ? CLASS_ORDER.length : idx;
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function headerRowStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

// GET /api/export/pickup?branch=...&month=2026-08
// One row per student per 登園/降園, one column per day -- matches the
// on-screen 送迎管理 grid exactly (same class grouping/order, same ✓ marks,
// same weekend/降園 shading).
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch");
  const yearMonth = req.nextUrl.searchParams.get("month");

  if (!branch || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: "Missing or invalid 'branch'/'month' query params" },
      { status: 400 }
    );
  }

  const [year, month] = yearMonth.split("-").map(Number);
  const numDays = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

  try {
    const [allStudents, allRecords] = await Promise.all([
      getStudentsByBranch(branch),
      getPickupRecordsForMonth(yearMonth),
    ]);

    const students = [...allStudents].sort(
      (a, b) => classOrderIndex(a.className) - classOrderIndex(b.className)
    );
    const studentIds = new Set(students.map((s) => s.studentId));
    const recordByKey = new Map(
      allRecords
        .filter((r) => studentIds.has(r.studentId))
        .map((r) => [`${r.studentId}|${r.date}`, r])
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`${branch}_${yearMonth}`, {
      views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
    });

    const headerRow = sheet.addRow([
      "氏名",
      "英語名",
      "区分",
      ...dayNumbers.map((day) => {
        const dow = new Date(year, month - 1, day).getDay();
        return `${day}\n${WEEKDAY_LABELS[dow]}`;
      }),
    ]);
    headerRowStyle(headerRow);
    sheet.getRow(1).height = 28;

    const WEEKEND_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD1D5DB" }, // gray-300, matches the on-screen dark-gray weekend tint
    };
    const DEPARTURE_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF7ED" }, // orange-50
    };
    const CLASS_HEADER_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFF6FF" }, // blue-50
    };

    let lastClassName: string | null = null;
    for (const s of students) {
      if (s.className !== lastClassName) {
        lastClassName = s.className;
        const groupRow = sheet.addRow([s.className]);
        sheet.mergeCells(groupRow.number, 1, groupRow.number, 3 + numDays);
        groupRow.font = { bold: true, color: { argb: "FF1E40AF" } };
        groupRow.eachCell((cell) => (cell.fill = CLASS_HEADER_FILL));
      }

      (["arrival", "departure"] as const).forEach((field, fi) => {
        const row = sheet.addRow([
          fi === 0 ? s.nameKanji : "",
          fi === 0 ? s.nameEnglish : "",
          field === "arrival" ? "登園" : "降園",
          ...dayNumbers.map((day) => {
            const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const rec = recordByKey.get(`${s.studentId}|${date}`);
            const value = field === "arrival" ? rec?.arrivalTime : rec?.departureTime;
            return value ? "○" : "";
          }),
        ]);
        row.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: "middle", horizontal: "center" };
          if (colNumber <= 3) return;
          const day = dayNumbers[colNumber - 4];
          const dow = new Date(year, month - 1, day).getDay();
          if (dow === 0 || dow === 6) {
            cell.fill = WEEKEND_FILL;
          } else if (field === "departure") {
            cell.fill = DEPARTURE_FILL;
          }
          if (cell.value === "○") {
            cell.font = { color: { argb: "FFDC2626" }, bold: true };
          }
        });
      });
    }

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 16;
    sheet.getColumn(3).width = 7;
    for (let i = 0; i < numDays; i++) sheet.getColumn(4 + i).width = 4.5;

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${branch}_送迎_${yearMonth}.xlsx`;

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
