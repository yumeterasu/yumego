import { NextRequest, NextResponse } from "next/server";
import { deactivateAllStudents, deleteSpecialistAttendanceForGrade, deleteSpecialistParticipationForGrade } from "@/lib/sheets";
import { classNameToBranchGrade } from "@/lib/classes";

// POST /api/students/reset
// body: { className, rosterToo?: boolean }
// The end-of-term Reset: soft-deletes every active student in the class
// (recoverable individually via "削除した生徒を表示") AND, for classes on
// the 長/中/少 continuum, permanently deletes this grade's Coach Schedule +
// Coach Headcount history too (NOT recoverable — categories themselves are
// branch-wide and untouched, other grades keep their data).
//
// 小学生-suffix "extra" classes have no branch/grade and thus no coach data
// to begin with (classNameToBranchGrade() returns null for them) -- Reset
// still works for them, it just skips that part entirely (both counts come
// back 0) rather than being blocked outright.
//
// rosterToo defaults to true (the original full reset). Pass false to only
// clear the Coach Schedule/Headcount records and leave the roster
// untouched — e.g. when the class's data is no longer needed but its
// students are about to move to another class, not be withdrawn. (Only
// meaningful for a branch/grade class -- there's nothing to clear
// otherwise.)
//
// The client is responsible for only calling this AFTER successfully
// downloading the backup from /api/export/reset-backup — this route does
// not generate or check for a backup itself, it trusts the caller's
// sequencing (see the two-step confirm flow on the students page).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { className, rosterToo } = body ?? {};

  if (!className || typeof className !== "string") {
    return NextResponse.json({ error: "Missing className" }, { status: 400 });
  }
  const branchGrade = classNameToBranchGrade(className);

  try {
    const deactivated = rosterToo === false ? [] : await deactivateAllStudents(className);
    const scheduleDeleted = branchGrade
      ? await deleteSpecialistAttendanceForGrade(branchGrade.branch, branchGrade.grade)
      : 0;
    const headcountDeleted = branchGrade
      ? await deleteSpecialistParticipationForGrade(branchGrade.branch, branchGrade.grade)
      : 0;

    return NextResponse.json({
      ok: true,
      studentsRemoved: deactivated.length,
      scheduleRowsDeleted: scheduleDeleted,
      headcountRowsDeleted: headcountDeleted,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to reset class" }, { status: 500 });
  }
}
