import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getStudentsByClass,
  getAttendanceForMonth,
  getClassCheckLabels,
  getMonthlyChecks,
} from "@/lib/sheets";
import { addMonthlySheet } from "@/lib/exportSheets";

// GET /api/export/monthly?class=...&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const yearMonth = req.nextUrl.searchParams.get("month");

  if (!className || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const [students, records, checkLabels, checks] = await Promise.all([
      getStudentsByClass(className),
      getAttendanceForMonth(className, yearMonth),
      getClassCheckLabels(className, yearMonth),
      getMonthlyChecks(className, yearMonth),
    ]);
    const monthlyChecks = new Map(checks.map((c) => [c.studentId, c]));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    addMonthlySheet(workbook, {
      sheetName: yearMonth,
      yearMonth,
      students,
      records,
      checkLabels,
      monthlyChecks,
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${className.replace(/\s+/g, "_")}_${yearMonth}.xlsx`;

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
