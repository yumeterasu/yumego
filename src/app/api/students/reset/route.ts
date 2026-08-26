import { NextRequest, NextResponse } from "next/server";
import { deactivateAllStudents, deleteSpecialistAttendanceForGrade, deleteSpecialistParticipationForGrade } from "@/lib/sheets";
import { classNameToBranchGrade } from "@/lib/classes";

// POST /api/students/reset
// body: { className, rosterToo?: boolean }
// The end-of-term Reset: soft-deletes every active student in the class
// (recoverable, same as remove-all) AND permanently deletes this grade's
// Coach Schedule + Coach Headcount history (NOT recoverable — categories
// themselves are branch-wide and untouched, other grades keep their data).
//
// rosterToo defaults to true (the original full reset). Pass false to only
// clear the Coach Schedule/Headcount records and leave the roster
// untouched — e.g. when the class's data is no longer needed but its
// students are about to move to another class, not be withdrawn.
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
  if (!branchGrade) {
    return NextResponse.json({ error: "Unrecognized class name" }, { status: 400 });
  }
  const { branch, grade } = branchGrade;

  try {
    const deactivated = rosterToo === false ? [] : await deactivateAllStudents(className);
    const scheduleDeleted = await deleteSpecialistAttendanceForGrade(branch, grade);
    const headcountDeleted = await deleteSpecialistParticipationForGrade(branch, grade);

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
