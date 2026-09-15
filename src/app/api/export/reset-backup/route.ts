import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getStudentsByClass,
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
// Backup for one class, generated right before a roster-clearing action
// (学期末リセット, or 全員削除 on the roster page) wipes it. Scoped to
// exactly 現在の生徒一覧 (the currently active roster) -- a student fully
// withdrawn/removed long before this backup is left out entirely, so the
// file doesn't keep accumulating every student who's ever passed through
// this class. The 年間まとめ and monthly sheets are built with the exact
// same layout as the Dashboard's own 📊 Excel export buttons (see
// src/lib/exportSheets.ts) — one sheet per fiscal year and per calendar
// month actually present in the active roster's own attendance history.
//
// 専門コーチ (Coach Schedule/Headcount) sheets only apply to classes on the
// 長/中/少 continuum -- classNameToBranchGrade() returns null for 小学生-
// suffix "extra" classes, which simply never have that data, so those two
// sheets are included only when it resolves rather than rejecting the
// whole backup outright.
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  if (!className) {
    return NextResponse.json({ error: "Missing 'class' query param" }, { status: 400 });
  }
  const branchGrade = classNameToBranchGrade(className);

  try {
    const [activeStudents, allAttendance, categories, schedule, headcount] = await Promise.all([
      getStudentsByClass(className),
      getAllAttendanceForClass(className),
      branchGrade ? getSpecialistCategories(branchGrade.branch) : Promise.resolve([]),
      branchGrade
        ? getAllSpecialistAttendanceForGrade(branchGrade.branch, branchGrade.grade)
        : Promise.resolve([]),
      branchGrade
        ? getAllSpecialistParticipationForGrade(branchGrade.branch, branchGrade.grade)
        : Promise.resolve([]),
    ]);

    const categoryNameById = new Map(categories.map((c) => [c.categoryId, c.name]));

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

    // The monthly/annual sheets are scoped to 現在の生徒一覧 (activeStudents)
    // only -- a student fully withdrawn/removed long ago (no longer there
    // at all) is left out here too, so the backup doesn't keep accumulating
    // every past student forever. A student who left mid-term via 退園日
    // instead of a full withdrawal is still active and still shows up here
    // with their history intact (Student.endDate already keeps everything
    // before it visible/counted, only excluding what's dated after it).
    const attendance = allAttendance.filter((r) =>
      activeStudents.some((s) => s.studentId === r.studentId)
    );
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
        students: activeStudents,
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
        students: activeStudents,
        records: monthRecords,
        checkLabels: monthCheckLabels,
        monthlyChecks: new Map(monthChecks.map((c) => [c.studentId, c])),
      });
    }

    // 専門コーチスケジュール／人数 — only exist for classes on the 長/中/少
    // continuum (see branchGrade above); omitted entirely for 小学生-suffix
    // classes rather than added as empty sheets.
    if (branchGrade) {
      const scheduleSheet = workbook.addWorksheet("コーチスケジュール");
      headerRowStyle(scheduleSheet.addRow(["日付", "種目"]));
      schedule.forEach((r) => {
        scheduleSheet.addRow([r.date, categoryNameById.get(r.categoryId) ?? r.categoryId]);
      });
      scheduleSheet.columns = [{ width: 12 }, { width: 20 }];

      const headcountSheet = workbook.addWorksheet("コーチ人数");
      headerRowStyle(headcountSheet.addRow(["日付", "種目", "人数"]));
      headcount.forEach((r) => {
        headcountSheet.addRow([r.date, categoryNameById.get(r.categoryId) ?? r.categoryId, r.count]);
      });
      headcountSheet.columns = [{ width: 12 }, { width: 20 }, { width: 8 }];
    }

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
