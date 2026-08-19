import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getAllStudentsByClass,
  getAllAttendanceForClass,
  getSpecialistCategories,
  getAllSpecialistAttendanceForGrade,
  getAllSpecialistParticipationForGrade,
} from "@/lib/sheets";
import { classNameToBranchGrade } from "@/lib/classes";

const STATUS_LABEL_JA: Record<string, string> = {
  present: "出席",
  absent: "欠席",
  late: "遅刻",
  early_leave: "早退",
  suspended: "出席停止",
};

function headerRowStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

// GET /api/export/reset-backup?class=...
// Full-history backup for one class, generated right before the end-of-term
// Reset button wipes its roster and its Coach Schedule/Headcount data. Not
// scoped to a fiscal year like the other exports — everything ever
// recorded, since after Reset the app itself won't show it anymore.
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

    const nameById = new Map(allStudents.map((s) => [s.studentId, s]));
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

    // Sheet 2: every attendance row this class ever recorded, in full —
    // not a monthly/annual summary, so nothing is lost even from before
    // the current fiscal year.
    const attendanceSheet = workbook.addWorksheet("出席記録");
    headerRowStyle(attendanceSheet.addRow(["日付", "名前", "状態", "理由"]));
    attendance.forEach((r) => {
      const student = nameById.get(r.studentId);
      const name = student
        ? student.nameEnglish
          ? `${student.nameKanji} (${student.nameEnglish})`
          : student.nameKanji
        : r.studentId;
      attendanceSheet.addRow([r.date, name, STATUS_LABEL_JA[r.status] ?? r.status, r.reason]);
    });
    attendanceSheet.columns = [{ width: 12 }, { width: 24 }, { width: 10 }, { width: 24 }];

    // Sheet 3: 専門コーチスケジュール — every day this grade was checked
    // off for each category. Categories themselves are branch-wide and
    // NOT deleted (other grades in this branch may still use them).
    const scheduleSheet = workbook.addWorksheet("コーチスケジュール");
    headerRowStyle(scheduleSheet.addRow(["日付", "種目"]));
    schedule.forEach((r) => {
      scheduleSheet.addRow([r.date, categoryNameById.get(r.categoryId) ?? r.categoryId]);
    });
    scheduleSheet.columns = [{ width: 12 }, { width: 20 }];

    // Sheet 4: 専門コーチ人数 — participant counts per category per day.
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
