import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getStudentsByClass, getAttendanceForFiscalYear } from "@/lib/sheets";
import { addAnnualSheet } from "@/lib/exportSheets";

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
    const [students, allRecords] = await Promise.all([
      getStudentsByClass(className),
      getAttendanceForFiscalYear(className, fiscalYearStart),
    ]);

    // A record dated before a student's own startDate, or after their
    // endDate, is excluded, same as the on-screen Dashboard/年間まとめ.
    // See Student.startDate/endDate.
    const startDateByStudent = new Map(students.map((s) => [s.studentId, s.startDate]));
    const endDateByStudent = new Map(students.map((s) => [s.studentId, s.endDate]));
    const records = allRecords.filter((r) => {
      const start = startDateByStudent.get(r.studentId);
      if (start && r.date < start) return false;
      const end = endDateByStudent.get(r.studentId);
      if (end && r.date > end) return false;
      return true;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    addAnnualSheet(workbook, {
      sheetName: `${fiscalYearStart}年度`,
      fiscalYearStart,
      students,
      records,
    });

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
