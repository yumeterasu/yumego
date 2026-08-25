// The two buckets a picked absence reason falls into — shared between the
// daily check-in page and the Dashboard's edit popup. The actual list of
// reasons (都合欠/病欠/インフルエンザ/...) is school-wide, Master-managed
// data now (see AbsenceReason in @/lib/sheets, fetched from
// /api/absence-reasons), not hardcoded here — admins edit it from
// 管理 → 欠席理由設定 without needing a code change.

export type AbsenceBucket = "absent" | "suspended";
