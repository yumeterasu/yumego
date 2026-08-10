"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import type { OutingLog } from "@/lib/sheets";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

type FormState = {
  id?: string; // present when editing an existing entry
  date: string;
  headcount: string; // kept as text while editing, parsed on submit
  departureTime: string;
  returnTime: string;
  description: string;
};

function blankForm(): FormState {
  return {
    date: todayDateString(),
    headcount: "",
    departureTime: "",
    returnTime: "",
    description: "",
  };
}

export default function OutingsPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const [entries, setEntries] = useState<OutingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const yearMonth = `${year}-${pad2(month)}`;

  const load = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/outings?class=${encodeURIComponent(selectedClass)}&month=${yearMonth}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, yearMonth]);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load();
  }, [loaded, selectedClass, router, load]);

  function goPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function openAddForm() {
    setFormError(null);
    setForm(blankForm());
  }

  function openEditForm(entry: OutingLog) {
    setFormError(null);
    setForm({
      id: entry.id,
      date: entry.date,
      headcount: String(entry.headcount),
      departureTime: entry.departureTime,
      returnTime: entry.returnTime,
      description: entry.description,
    });
  }

  async function submitForm() {
    if (!form || !selectedClass) return;
    const headcountNum = Number(form.headcount);
    if (!form.date || !form.departureTime) {
      setFormError("日付と出発時刻は必須です");
      return;
    }
    if (!Number.isFinite(headcountNum) || headcountNum < 0) {
      setFormError("人数を正しく入力してください");
      return;
    }

    setSaving(true);
    setFormError(null);
    const payload = {
      date: form.date,
      className: selectedClass,
      headcount: Math.floor(headcountNum),
      departureTime: form.departureTime,
      returnTime: form.returnTime,
      description: form.description,
    };
    try {
      const res = await fetch("/api/outings", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      });
      if (!res.ok) throw new Error("failed");
      setForm(null);
      await load();
    } catch {
      setFormError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: OutingLog) {
    const label = entry.description ? `（${entry.description}）` : "";
    if (
      !window.confirm(
        `${entry.date} ${entry.departureTime} 出発の記録${label}を削除しますか？`
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/outings?id=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("failed");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      setError("削除に失敗しました");
    }
  }

  if (!loaded || !selectedClass) return null;

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass} 外出記録</h1>
          <p className="text-sm text-gray-500">
            外出先は自由記入です（専門コーチの項目に限りません）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full border border-gray-300 text-gray-700 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={goPrevMonth}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="前の月"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-32 text-center">
          {year}年{month}月
        </p>
        <button
          onClick={goNextMonth}
          className="rounded-full border border-gray-300 w-9 h-9 flex items-center justify-center"
          aria-label="次の月"
        >
          ▶
        </button>
      </div>

      <button
        onClick={openAddForm}
        className="self-center rounded-full bg-black text-white px-5 py-2.5 text-sm font-semibold"
      >
        ＋ 記録を追加
      </button>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          この月の外出記録はまだありません
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl w-full mx-auto">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="border border-gray-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <div>
                <p className="font-semibold">
                  {entry.date}　{entry.departureTime}
                  {entry.returnTime ? `〜${entry.returnTime}` : "〜（未帰園）"}
                </p>
                <p className="text-sm text-gray-600">
                  {entry.headcount}人
                  {entry.description ? `　${entry.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEditForm(entry)}
                  className="rounded-full border border-gray-300 text-gray-700 px-3 py-1.5 text-xs font-semibold"
                >
                  編集
                </button>
                <button
                  onClick={() => handleDelete(entry)}
                  className="rounded-full border border-red-300 text-red-600 px-3 py-1.5 text-xs font-semibold"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && setForm(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 w-full max-w-sm flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg">
              {form.id ? "記録を編集" : "外出記録を追加"}
            </h2>

            <label className="flex flex-col gap-1 text-sm">
              日付
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => (f ? { ...f, date: e.target.value } : f))}
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              人数
              <input
                type="number"
                min={0}
                value={form.headcount}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, headcount: e.target.value } : f))
                }
                placeholder="例：15"
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>

            <div className="flex gap-3">
              <label className="flex flex-col gap-1 text-sm flex-1">
                出発時刻
                <input
                  type="time"
                  value={form.departureTime}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, departureTime: e.target.value } : f))
                  }
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm flex-1">
                帰園時刻（任意）
                <input
                  type="time"
                  value={form.returnTime}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, returnTime: e.target.value } : f))
                  }
                  className="border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              行き先・内容（任意）
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, description: e.target.value } : f))
                }
                placeholder="例：近所の公園"
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>

            {formError && <p className="text-red-600 text-sm">{formError}</p>}

            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setForm(null)}
                disabled={saving}
                className="rounded-full border border-gray-300 text-gray-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                onClick={submitForm}
                disabled={saving}
                className="rounded-full bg-black text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                {saving ? "保存中..." : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
