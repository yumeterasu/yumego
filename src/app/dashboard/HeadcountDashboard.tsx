"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { classNameToEnglish } from "@/lib/classes";
import { apiFetch, SessionExpiredError } from "@/lib/apiFetch";
import { SkeletonBlock } from "@/components/Skeleton";

type Field = "total" | "present" | "absent";

const FIELD_LABELS: Record<Field, { ja: string; en: string }> = {
  total: { ja: "全体人数", en: "Total" },
  present: { ja: "出席", en: "Present" },
  absent: { ja: "欠席", en: "Absent" },
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayDateString() {
  return formatDate(new Date());
}
function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return formatDate(dt);
}
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}年${m}月${d}日(${WEEKDAY_LABELS[dow]})`;
}

type Entry = { total: number | null; present: number | null; absent: number | null };
const EMPTY_ENTRY: Entry = { total: null, present: null, absent: null };

/**
 * Daily attendance entry for an ExtraClass with kind === "headcount" — no
 * student roster exists for these classes, so instead of the usual
 * per-student grid/check-in overlay, the teacher just types three
 * independent numbers for the day. Mirrors the save flow (floor/validate,
 * confirm-on-change, revert-on-failure) already used for 専門コーチ's "最"
 * row free numeric entry (src/app/dashboard/specialist/page.tsx).
 */
export default function HeadcountDashboard({
  className,
  extraClassEnNames,
}: {
  className: string;
  extraClassEnNames: Record<string, string>;
}) {
  const today = todayDateString();
  const [date, setDate] = useState(today);
  const savedRef = useRef<Entry>(EMPTY_ENTRY);
  const [draft, setDraft] = useState<Record<Field, string>>({ total: "", present: "", absent: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<Field | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(
      `/api/attendance-headcount?class=${encodeURIComponent(className)}&date=${date}`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((data: { entry: Entry | null }) => {
        if (cancelled) return;
        const next = data.entry ?? EMPTY_ENTRY;
        savedRef.current = next;
        setDraft({
          total: next.total === null ? "" : String(next.total),
          present: next.present === null ? "" : String(next.present),
          absent: next.absent === null ? "" : String(next.absent),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SessionExpiredError) {
          setError("__SESSION_EXPIRED__");
        } else {
          setError("データの取得に失敗しました / Failed to load data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [className, date]);

  async function commitField(field: Field, rawValue: string) {
    const original = savedRef.current[field];
    const trimmed = rawValue.trim();
    let parsed: number | null = trimmed === "" ? null : Number(trimmed);

    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setDraft((prev) => ({ ...prev, [field]: original === null ? "" : String(original) }));
      return;
    }
    if (parsed !== null) parsed = Math.floor(parsed);

    if (parsed === original) {
      setDraft((prev) => ({ ...prev, [field]: parsed === null ? "" : String(parsed) }));
      return;
    }

    // Number inputs misfire easily (scroll wheel, stray taps on the
    // up/down arrows) — confirm before actually writing a real change.
    const label = FIELD_LABELS[field];
    const fromLabel = original === null ? "未入力" : String(original);
    const toLabel = parsed === null ? "未入力" : String(parsed);
    if (
      !window.confirm(
        `${formatDateLabel(date)} の${label.ja}を ${fromLabel} → ${toLabel} に変更しますか？\nChange ${label.en} for ${formatDateLabel(
          date
        )} from ${fromLabel} to ${toLabel}?`
      )
    ) {
      setDraft((prev) => ({ ...prev, [field]: original === null ? "" : String(original) }));
      return;
    }

    const nextEntry: Entry = { ...savedRef.current, [field]: parsed };
    setSavingField(field);
    setError(null);
    try {
      const res = await fetch("/api/attendance-headcount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className, date, ...nextEntry }),
      });
      if (!res.ok) throw new Error("failed");
      savedRef.current = nextEntry;
      setDraft((prev) => ({ ...prev, [field]: parsed === null ? "" : String(parsed) }));
    } catch {
      setError("保存に失敗しました / Failed to save");
      setDraft((prev) => ({ ...prev, [field]: original === null ? "" : String(original) }));
    } finally {
      setSavingField(null);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{className}</h1>
          <p className="text-xs text-gray-400">{classNameToEnglish(className, extraClassEnNames)}</p>
          <p className="text-sm text-gray-500">
            出席人数記録
            <span className="ml-1 text-xs text-gray-400">Headcount Record</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <Link
            href="/"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600 text-sm text-center">
            {error === "__SESSION_EXPIRED__"
              ? "セッションの有効期限が切れました / Your session has expired"
              : error}
          </p>
          {error === "__SESSION_EXPIRED__" && (
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 text-base font-semibold"
            >
              🔄 ページを再読み込み
              <span className="block text-xs font-normal opacity-80">Reload page</span>
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="前日 / Previous day"
        >
          ◀
        </button>
        <div className="flex flex-col items-center">
          <p className="text-lg font-bold w-48 text-center">{formatDateLabel(date)}</p>
          <button
            onClick={() => setDate(today)}
            tabIndex={date === today ? -1 : 0}
            className={`text-xs text-blue-600 underline ${date === today ? "invisible" : ""}`}
          >
            今日に戻る / Back to today
          </button>
        </div>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="翌日 / Next day"
        >
          ▶
        </button>
      </div>

      <div className="max-w-sm mx-auto w-full">
        {loading ? (
          <SkeletonBlock />
        ) : (
          <div className="border rounded-xl p-4 flex flex-col gap-4">
            {(["total", "present", "absent"] as Field[]).map((field) => (
              <label key={field} className="flex flex-col gap-1 text-sm">
                {FIELD_LABELS[field].ja}
                <span className="text-xs font-normal text-gray-500">{FIELD_LABELS[field].en}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={draft[field]}
                  disabled={savingField !== null}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                  onBlur={(e) => commitField(field, e.target.value)}
                  placeholder="未入力 / Not entered"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-lg font-semibold disabled:opacity-50"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
