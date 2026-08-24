import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getAllStudentsByClass,
  getAllAttendanceForClass,
  getClassCheckLabels,
  getMonthlyChecks,
  getSpecialistCategories,
  getAllSpecialistAttendanceForGrade,
  getAllSpecialistParticipationForGrade,
} from "@/lib/sheets";
import { classNameToBranchGrade } from "@/lib/classes";
import { addMonthlySheet, addAnnualSheet, yearMonthToFiscalYearStart } from "@/lib/exportSheets";

function headerRowStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

// GET /api/export/reset-backup?class=...
// Full-history backup for one class, generated right before the end-of-term
// Reset button wipes its roster and its Coach Schedule/Headcount data. The
// 年間まとめ and monthly sheets are built with the exact same layout as the
// Dashboard's own 📊 Excel export buttons (see src/lib/exportSheets.ts) —
// one sheet per fiscal year and per calendar month actually present in the
// data, so nothing is lost even from years before the current one.
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  if (!className) {
    return NextResponse.json({ error: "Missing 'class' query param" }, { status: 400 });
  }
  const branchGrade = classNameToBranchGrade(className);
  if (!branchGrade) {
    return NextResponse.json({ error: "Unrecognized class name" }, { status: 400 });
  }
  const { branch, grade } = branchGrade;

  try {
    const [allStudents, attendance, categories, schedule, headcount] = await Promise.all([
      getAllStudentsByClass(className),
      getAllAttendanceForClass(className),
      getSpecialistCategories(branch),
      getAllSpecialistAttendanceForGrade(branch, grade),
      getAllSpecialistParticipationForGrade(branch, grade),
    ]);

    const categoryNameById = new Map(categories.map((c) => [c.categoryId, c.name]));
    const activeStudents = allStudents.filter((s) => s.active);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();

    // Sheet 1: exactly who was on the active roster at the moment of reset.
    const rosterSheet = workbook.addWorksheet("生徒名簿");
    headerRowStyle(rosterSheet.addRow(["名前（漢字）", "名前（英語）", "備考"]));
    activeStudents.forEach((s) => {
      rosterSheet.addRow([s.nameKanji, s.nameEnglish, s.remark ?? ""]);
    });
    rosterSheet.columns = [{ width: 20 }, { width: 20 }, { width: 30 }];

    // The monthly/annual sheets use EVERY student who ever has an
    // attendance row for this class — not just activeStudents — so a kid
    // who left mid-year (individually removed before this Reset) still
    // shows up in the historical record instead of silently dropping out.
    const monthsPresent = Array.from(new Set(attendance.map((r) => r.date.slice(0, 7)))).sort();
    const fiscalYearsPresent = Array.from(
      new Set(monthsPresent.map((ym) => yearMonthToFiscalYearStart(ym)))
    ).sort((a, b) => a - b);

    // Sheets: 年間まとめ, one per fiscal year actually present.
    for (const fiscalYearStart of fiscalYearsPresent) {
      const startDate = `${fiscalYearStart}-04-01`;
      const endDate = `${fiscalYearStart + 1}-03-31`;
      const yearRecords = attendance.filter((r) => r.date >= startDate && r.date <= endDate);
      addAnnualSheet(workbook, {
        sheetName: `${fiscalYearStart}年度まとめ`,
        fiscalYearStart,
        students: allStudents,
        records: yearRecords,
      });
    }

    // Sheets: one per calendar month actually present, same day-by-day
    // grid as the Dashboard's own monthly export. チェック1/2/3 labels and
    // state are scoped per month now, so both are fetched per month here
    // too — a label typed in for one month never bleeds into another.
    for (const yearMonth of monthsPresent) {
      const monthRecords = attendance.filter((r) => r.date.startsWith(yearMonth));
      const [monthCheckLabels, monthChecks] = await Promise.all([
        getClassCheckLabels(className, yearMonth),
        getMonthlyChecks(className, yearMonth),
      ]);
      addMonthlySheet(workbook, {
        sheetName: yearMonth,
        yearMonth,
        students: allStudents,
        records: monthRecords,
        checkLabels: monthCheckLabels,
        monthlyChecks: new Map(monthChecks.map((c) => [c.studentId, c])),
      });
    }

    // 専門コーチスケジュール — every day this grade was checked off for
    // each category. Categories themselves are branch-wide and NOT
    // deleted (other grades in this branch may still use them).
    const scheduleSheet = workbook.addWorksheet("コーチスケジュール");
    headerRowStyle(scheduleSheet.addRow(["日付", "種目"]));
    schedule.forEach((r) => {
      scheduleSheet.addRow([r.date, categoryNameById.get(r.categoryId) ?? r.categoryId]);
    });
    scheduleSheet.columns = [{ width: 12 }, { width: 20 }];

    // 専門コーチ人数 — participant counts per category per day.
    const headcountSheet = workbook.addWorksheet("コーチ人数");
    headerRowStyle(headcountSheet.addRow(["日付", "種目", "人数"]));
    headcount.forEach((r) => {
      headcountSheet.addRow([r.date, categoryNameById.get(r.categoryId) ?? r.categoryId, r.count]);
    });
    headcountSheet.columns = [{ width: 12 }, { width: 20 }, { width: 8 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const todayStr = new Date().toISOString().slice(0, 10);
    const fileName = `${className.replace(/\s+/g, "_")}_reset-backup_${todayStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to build backup" }, { status: 500 });
  }
}
