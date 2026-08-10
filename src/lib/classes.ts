export const CLASSES = [
  "プロンポン　年長",
  "プロンポン　年中",
  "プロンポン　年少",
  "トンロー　年長",
  "トンロー　年中",
  "トンロー　年少",
] as const;

export type ClassName = (typeof CLASSES)[number];

export const SELECTED_CLASS_KEY = "yumego.selectedClass";

export type Branch = "プロンポン" | "トンロー";
export type GradeShort = "長" | "中" | "少";

/**
 * "プロンポン　年長" -> { branch: "プロンポン", grade: "長" }.
 * Used to scope the 専門コーチ checklist to the tablet's locked class
 * without needing a separate branch/grade picker.
 */
export function classNameToBranchGrade(
  className: string
): { branch: Branch; grade: GradeShort } | null {
  const [branch, gradeFull] = className.split("　");
  if (branch !== "プロンポン" && branch !== "トンロー") return null;
  const grade = gradeFull?.slice(1);
  if (grade !== "長" && grade !== "中" && grade !== "少") return null;
  return { branch, grade };
}
