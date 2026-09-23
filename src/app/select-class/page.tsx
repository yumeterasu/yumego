"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CLASSES, classNameToEnglish } from "@/lib/classes";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { useExtraClasses } from "@/hooks/useExtraClasses";
import { useClassColors } from "@/hooks/useClassColors";
import { useClassTeachers } from "@/hooks/useClassTeachers";
import {
  CLASS_COLOR_CARD_STYLES,
  CLASS_COLOR_DEFAULT_CARD_STYLE,
  isClassColorKey,
} from "@/lib/classColors";
import type { OutingLog } from "@/lib/sheets";

// A departure not yet marked back after this long gets flagged on this
// page -- staff land here first, so a forgotten check-in surfaces here
// rather than staying silent until someone happens to open 入退出記録.
const OVERDUE_HOURS = 3;

// The fixed 3-grade continuum, split by branch. "Extra" classes (like
// トンロー　小学生) are Master-managed now — see useExtraClasses() below,
// computed per-render since they can be added/renamed/deactivated live.
const PROMPONG_REGULAR = CLASSES.filter((c) => c.startsWith("プロンポン"));
const THONGLOR_REGULAR = CLASSES.filter((c) => c.startsWith("トンロー"));

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateString(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayDateString() {
  return toDateString(new Date());
}

function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return toDateString(date);
}

export default function SelectClassPage() {
  const router = useRouter();
  const { setSelectedClass } = useSelectedClass();
  const { activeClasses, enNames: extraClassEnNames } = useExtraClasses();
  const { colors: classColors } = useClassColors();
  const { teacherNames: classTeachers } = useClassTeachers();

  const promponExtra = activeClasses
    .filter((c) => c.branch === "プロンポン")
    .map((c) => `プロンポン　${c.suffix}`);
  const thonglorExtra = activeClasses
    .filter((c) => c.branch === "トンロー")
    .map((c) => `トンロー　${c.suffix}`);

  const today = todayDateString();
  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/daily?date=${date}`);
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setSummary(data.summary ?? {});
    } catch {
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary(selectedDate);
  }, [selectedDate, loadSummary]);

  const [overdueOutings, setOverdueOutings] = useState<OutingLog[]>([]);

  const loadOverdueOutings = useCallback(async () => {
    const ym = todayDateString().slice(0, 7);
    try {
      const [pp, tl] = await Promise.all([
        fetch(`/api/outings?branch=${encodeURIComponent("プロンポン")}&month=${ym}`).then((r) =>
          r.ok ? r.json() : { entries: [] }
        ),
        fetch(`/api/outings?branch=${encodeURIComponent("トンロー")}&month=${ym}`).then((r) =>
          r.ok ? r.json() : { entries: [] }
        ),
      ]);
      const all: OutingLog[] = [...(pp.entries ?? []), ...(tl.entries ?? [])];
      const now = Date.now();
      setOverdueOutings(
        all.filter((e) => {
          if (e.returnTime !== "") return false;
          const [h, m] = e.departureTime.split(":").map(Number);
          const [y, mo, d] = e.date.split("-").map(Number);
          const departedAt = new Date(y, mo - 1, d, h, m).getTime();
          return now - departedAt >= OVERDUE_HOURS * 60 * 60 * 1000;
        })
      );
    } catch {
      // non-fatal -- this is a supplementary heads-up, not core functionality
    }
  }, []);

  useEffect(() => {
    loadOverdueOutings();
    const timer = setInterval(loadOverdueOutings, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [loadOverdueOutings]);

  function handleSelect(className: string) {
    setSelectedClass(className);
    router.replace("/dashboard");
  }

  function ClassButton({ name }: { name: string }) {
    const count = summary[name];
    const checked = count !== undefined;
    const colorKey = classColors[name];
    const colorStyle =
      colorKey && isClassColorKey(colorKey)
        ? CLASS_COLOR_CARD_STYLES[colorKey]
        : CLASS_COLOR_DEFAULT_CARD_STYLE;
    const teacherName = classTeachers[name];
    return (
      <button
        onClick={() => handleSelect(name)}
        className={`relative rounded-xl border px-6 py-4 text-lg font-semibold active:scale-95 transition ${colorStyle}`}
      >
        <span className="block">{name}</span>
        <span className="block text-xs font-normal opacity-70">
          {classNameToEnglish(name, extraClassEnNames)}
        </span>
        {teacherName && (
          <span className="block text-xs font-normal opacity-70 mt-0.5">👩‍🏫 {teacherName}</span>
        )}
        {checked && (
          <span className="absolute top-1.5 right-3 text-sm font-bold text-green-700 bg-green-50 border border-green-300 rounded-full px-2 py-0.5">
            出席 {count}
            <span className="block text-[9px] font-normal">Present</span>
          </span>
        )}
      </button>
    );
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center gap-3 p-4">
      {/* 管理 — branch-agnostic utility, tucked in its own corner instead of
          competing with the branch-specific buttons below. */}
      <Link
        href="/dashboard/admin-menu"
        className="absolute top-4 right-4 rounded-full bg-gray-100 text-gray-600 px-4 py-2 text-sm font-semibold text-center"
      >
        ⚙ 管理
        <span className="block text-[9px] font-normal opacity-70">Management</span>
      </Link>

      {/* Date picker -- topmost, shared by both branches (used for the 出席
          count badges below). "今日に戻る" is absolutely positioned below
          the row instead of stacked inline, so it never affects the row's
          own height (◀/date/▶ always align on one line) or width (never
          shifts ◀/▶ sideways when it toggles) -- the row keeps a fixed
          bottom margin so there's always room for it to appear without
          overlapping what's below. */}
      <div className="relative flex items-center gap-4 mb-5">
        <button
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          className="rounded-full bg-gray-100 text-gray-600 w-8 h-8 flex items-center justify-center"
          aria-label="前の日 / Previous day"
        >
          ◀
        </button>
        <p className="font-bold text-sm w-24 text-center">{selectedDate}</p>
        <button
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          disabled={selectedDate >= today}
          className="rounded-full bg-gray-100 text-gray-600 w-8 h-8 flex items-center justify-center disabled:opacity-30"
          aria-label="次の日 / Next day"
        >
          ▶
        </button>
        <button
          onClick={() => setSelectedDate(today)}
          tabIndex={selectedDate === today ? -1 : 0}
          className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 text-xs text-blue-600 underline whitespace-nowrap ${
            selectedDate === today ? "invisible" : ""
          }`}
        >
          今日に戻る / Back to today
        </button>
      </div>

      {/* 送迎管理/入退出記録 — separate whole-branch entry points, not gated
          on a class. Split visibly left (プロンポン) / right (トンロー),
          mirroring the プロンポン/トンロー class-grid split further down
          the page. */}
      <div className="w-full max-w-3xl flex flex-col md:flex-row items-center justify-center md:items-start md:justify-between gap-4">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-sm font-bold text-gray-700">
            プロンポン
            <span className="block text-[10px] font-normal opacity-70">Phrom Phong</span>
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard/pickup?branch=プロンポン"
              className="rounded-full bg-blue-50 border border-blue-300 text-blue-700 px-4 py-2 text-sm font-semibold text-center"
            >
              🚗 送迎管理　プロンポン
              <span className="block text-[9px] font-normal opacity-70">
                Pickup/Drop-off · Phrom Phong
              </span>
            </Link>
            <Link
              href="/dashboard/outings?branch=プロンポン"
              className="rounded-full bg-purple-50 border border-purple-300 text-purple-700 px-4 py-2 text-sm font-semibold text-center"
            >
              🚪 入退出記録　プロンポン
              <span className="block text-[9px] font-normal opacity-70">
                Entry/Exit Log · Phrom Phong
              </span>
            </Link>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h2 className="text-sm font-bold text-gray-700">
            トンロー
            <span className="block text-[10px] font-normal opacity-70">Thong Lo</span>
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard/pickup?branch=トンロー"
            className="rounded-full bg-blue-50 border border-blue-300 text-blue-700 px-4 py-2 text-sm font-semibold text-center"
          >
            🚗 送迎管理　トンロー
            <span className="block text-[9px] font-normal opacity-70">
              Pickup/Drop-off · Thong Lo
            </span>
          </Link>
          <Link
            href="/dashboard/outings?branch=トンロー"
            className="rounded-full bg-purple-50 border border-purple-300 text-purple-700 px-4 py-2 text-sm font-semibold text-center"
          >
            🚪 入退出記録　トンロー
            <span className="block text-[9px] font-normal opacity-70">
              Entry/Exit Log · Thong Lo
            </span>
          </Link>
          </div>
        </div>
      </div>

      {overdueOutings.length > 0 && (
        <div className="w-full max-w-2xl bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-sm text-amber-800 font-semibold">
            ⚠ 3時間以上戻っていない外出が {overdueOutings.length}件あります
            <span className="block text-xs font-normal">
              {overdueOutings.length} outing(s) not back for over 3 hours
            </span>
          </p>
          {overdueOutings.map((e) => {
            const branch = e.className.split("　")[0];
            return (
              <Link
                key={e.id}
                href={`/dashboard/outings?branch=${encodeURIComponent(branch)}`}
                className="text-xs text-amber-700 underline"
              >
                {e.className}　{e.departureTime}〜　{e.description || "（行き先未記入）"}
              </Link>
            );
          })}
        </div>
      )}

      {/* Tablet / mobile: simple single grid, unchanged */}
      <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        {[...PROMPONG_REGULAR, ...THONGLOR_REGULAR].map((name) => (
          <ClassButton key={name} name={name} />
        ))}
        {(promponExtra.length > 0 || thonglorExtra.length > 0) && (
          <div className="col-span-full border-t border-gray-200 my-1" />
        )}
        {[...promponExtra, ...thonglorExtra].map((name) => (
          <ClassButton key={name} name={name} />
        ))}
      </div>

      {/* Desktop (wide screens): split into プロンポン (left) / トンロー (right) */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-10 w-full max-w-2xl">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-center text-gray-700">
            プロンポン
            <span className="block text-xs font-normal opacity-70">Phrom Phong</span>
          </h2>
          {PROMPONG_REGULAR.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
          {promponExtra.length > 0 && (
            <>
              <div className="border-t border-gray-200 my-1" />
              {promponExtra.map((name) => (
                <ClassButton key={name} name={name} />
              ))}
            </>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-center text-gray-700">
            トンロー
            <span className="block text-xs font-normal opacity-70">Thong Lo</span>
          </h2>
          {THONGLOR_REGULAR.map((name) => (
            <ClassButton key={name} name={name} />
          ))}
          {thonglorExtra.length > 0 && (
            <>
              <div className="border-t border-gray-200 my-1" />
              {thonglorExtra.map((name) => (
                <ClassButton key={name} name={name} />
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
