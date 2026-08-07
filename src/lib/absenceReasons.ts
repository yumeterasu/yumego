// The only reasons a teacher can pick when marking someone absent —
// shared between the daily check-in page and the dashboard's edit popup
// so both stay in sync. No plain "欠席"/"出席停止" without a reason.

export type AbsenceBucket = "absent" | "suspended";

export const REASON_OPTIONS: { label: string; status: AbsenceBucket }[] = [
  { label: "事故欠", status: "absent" },
  { label: "病欠", status: "absent" },
  { label: "インフルエンザ", status: "suspended" },
  { label: "手足口病", status: "suspended" },
  { label: "コロナ", status: "suspended" },
];
