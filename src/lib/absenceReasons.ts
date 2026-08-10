// The only reasons a teacher can pick when marking someone absent —
// shared between the daily check-in page and the dashboard's edit popup
// so both stay in sync. No plain "欠席"/"出席停止" without a reason.

export type AbsenceBucket = "absent" | "suspended";

export const REASON_OPTIONS: { label: string; en: string; status: AbsenceBucket }[] = [
  { label: "事故欠", en: "Accident/Injury", status: "absent" },
  { label: "病欠", en: "Sick", status: "absent" },
  { label: "インフルエンザ", en: "Influenza", status: "suspended" },
  { label: "手足口病", en: "Hand-Foot-Mouth Disease", status: "suspended" },
  { label: "コロナ", en: "COVID-19", status: "suspended" },
];
