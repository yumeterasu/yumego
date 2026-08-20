import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getSpecialistCategories,
  getSpecialistAttendance,
  getSpecialistParticipation,
} from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const GRADES = ["長", "中", "少"] as const;

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

// GET /api/export/specialist?branch=プロンポン&month=2026-08
// Mirrors the merged 専門コーチ page on screen: one row per category+grade,
// each day cell shows the participant count if entered, else a checkmark
// if just checked, else blank — exactly what the on-screen cell shows.
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch");
  const yearMonth = req.nextUrl.searchParams.get("month");

  if (!branch || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: "Missing or invalid 'branch'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const [categories, schedule, headcount] = await Promise.all([
      getSpecialistCategories(branch),
      getSpecialistAttendance(branch, yearMonth),
      getSpecialistParticipation(branch, yearMonth),
    ]);

    const [year, month] = yearMonth.split("-").map(Number);
    const numDays = daysInMonth(year, month);
    const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

    // "categoryId|grade" -> Set of checked "YYYY-MM-DD"
    const checkedByKey = new Map<string, Set<string>>();
    for (const c of schedule) {
      const key = `${c.categoryId}|${c.grade}`;
      if (!checkedByKey.has(key)) checkedByKey.set(key, new Set());
      checkedByKey.get(key)!.add(c.date);
    }
    // "categoryId|grade|date" -> count
    const countByKey = new Map<string, number>();
    for (const c of headcount) {
      countByKey.set(`${c.categoryId}|${c.grade}|${c.date}`, c.count);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`${branch}_${yearMonth}`, {
      views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
    });

    const headerRow = sheet.addRow([
      "項目",
      "学年",
      ...dayNumbers.map((d) => `${d}(${WEEKDAY_LABELS[new Date(year, month - 1, d).getDay()]})`),
      "回数",
      "人数計",
      "全学年合計",
    ]);
    headerRowStyle(headerRow);

    let rowNum = 1; // header is row 1
    categories.forEach((cat) => {
      const categoryStartRow = rowNum + 1;

      const gradeCountTotals: Record<string, number> = { 長: 0, 中: 0, 少: 0 };

      GRADES.forEach((grade) => {
        const key = `${cat.categoryId}|${grade}`;
        const checkedDates = checkedByKey.get(key) ?? new Set<string>();
        const daysChecked = checkedDates.size;

        let countTotal = 0;
        const dayValues = dayNumbers.map((day) => {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const countKey = `${cat.categoryId}|${grade}|${date}`;
          const count = countByKey.get(countKey);
          if (count !== undefined) {
            countTotal += count;
            return count;
          }
          return checkedDates.has(date) ? "✓" : "";
        });
        gradeCountTotals[grade] = countTotal;

        const row = sheet.addRow([
          cat.name,
          grade,
          ...dayValues,
          daysChecked || "",
          countTotal || "",
          "", // filled in after all 3 grades via merge below
        ]);
        row.getCell(1).alignment = { vertical: "middle" };
        row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
        for (let i = 0; i < dayNumbers.length; i++) {
          row.getCell(3 + i).alignment = { horizontal: "center", vertical: "middle" };
        }
        rowNum++;
      });

      const categoryTotal = GRADES.reduce((sum, g) => sum + gradeCountTotals[g], 0);
      const categoryEndRow = rowNum;

      // Merge 項目 and 全学年合計 across the 3 grade rows, matching the
      // rowSpan the on-screen table uses for the same cells.
      sheet.mergeCells(categoryStartRow, 1, categoryEndRow, 1);
      sheet.mergeCells(
        categoryStartRow,
        3 + dayNumbers.length + 2,
        categoryEndRow,
        3 + dayNumbers.length + 2
      );
      const totalCell = sheet.getRow(categoryStartRow).getCell(3 + dayNumbers.length + 2);
      totalCell.value = categoryTotal || "";
      totalCell.alignment = { horizontal: "center", vertical: "middle" };
      totalCell.font = { bold: true, color: { argb: "FF047857" } };
    });

    sheet.columns = [
      { width: 16 },
      { width: 6 },
      ...dayNumbers.map(() => ({ width: 6 })),
      { width: 8 },
      { width: 9 },
      { width: 10 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${branch}_専門コーチ_${yearMonth}.xlsx`;

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
