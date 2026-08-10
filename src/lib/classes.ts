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

/** Inverse of classNameToBranchGrade: { プロンポン, 長 } -> "プロンポン　年長". */
export function branchGradeToClassName(branch: Branch, grade: GradeShort): ClassName {
  return `${branch}　年${grade}` as ClassName;
}

const BRANCH_EN: Record<Branch, string> = {
  プロンポン: "Phrom Phong",
  トンロー: "Thong Lo",
};

const GRADE_EN: Record<GradeShort, string> = {
  長: "Older Class (K3)",
  中: "Middle Class (K2)",
  少: "Younger Class (K1)",
};

/** "プロンポン　年長" -> "Phrom Phong · Older Class (K3)", for the English gloss under class names. */
export function classNameToEnglish(className: string): string {
  const bg = classNameToBranchGrade(className);
  if (!bg) return "";
  return `${BRANCH_EN[bg.branch]} · ${GRADE_EN[bg.grade]}`;
}

export function branchToEnglish(branch: Branch): string {
  return BRANCH_EN[branch];
}

export function gradeToEnglish(grade: GradeShort): string {
  return GRADE_EN[grade];
}
