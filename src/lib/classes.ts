// The fixed 年少/年中/年長 continuum, per branch — 専門コーチ scoping,
// promotion logic (nextGradeClassName), and Reset all depend on exactly
// this shape, so it stays hardcoded. Classes OUTSIDE this continuum (like
// トンロー　小学生) are Master-managed instead — see ExtraClass in
// @/lib/sheets and useExtraClasses() — not listed here.
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

// Age-based, not K-grade-based — this school doesn't use "K1/K2/K3".
const GRADE_EN: Record<GradeShort, string> = {
  長: "Older Class (5 Years Old)",
  中: "Middle Class (4 Years Old)",
  少: "Younger Class (3 Years Old)",
};

/**
 * "プロンポン　年長" -> "Phrom Phong · Older Class (5 Years Old)", for the
 * English gloss under class names. `extraClassEnNames` (from
 * useExtraClasses()) supplies the live gloss for Master-managed classes
 * outside the 長/中/少 continuum — pass it wherever available so a renamed
 * extra class's English text updates everywhere without a code change.
 */
export function classNameToEnglish(
  className: string,
  extraClassEnNames?: Record<string, string>
): string {
  const bg = classNameToBranchGrade(className);
  if (bg) return `${BRANCH_EN[bg.branch]} · ${GRADE_EN[bg.grade]}`;

  if (extraClassEnNames?.[className]) return extraClassEnNames[className];

  // Fallback for the one legacy extra class, in case this renders before
  // useExtraClasses() has finished its first fetch.
  const [branch, suffix] = className.split("　");
  if ((branch === "プロンポン" || branch === "トンロー") && suffix === "小学生") {
    return `${BRANCH_EN[branch]} · Elementary School`;
  }
  return "";
}

export function branchToEnglish(branch: Branch): string {
  return BRANCH_EN[branch];
}

export function gradeToEnglish(grade: GradeShort): string {
  return GRADE_EN[grade];
}

// 少 (youngest) -> 中 -> 長 (oldest) -> graduates (no next class).
const NEXT_GRADE: Record<GradeShort, GradeShort | null> = {
  少: "中",
  中: "長",
  長: null,
};

/**
 * "プロンポン　年少" -> "プロンポン　年中" (same branch, next grade up).
 * Returns null for 年長 — there's no next class, promoting means graduating
 * (deactivate) instead of moving to a new class.
 */
export function nextGradeClassName(className: string): ClassName | null {
  const bg = classNameToBranchGrade(className);
  if (!bg) return null;
  const nextGrade = NEXT_GRADE[bg.grade];
  if (!nextGrade) return null;
  return branchGradeToClassName(bg.branch, nextGrade);
}
