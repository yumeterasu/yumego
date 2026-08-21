"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { classNameToEnglish } from "@/lib/classes";
import type { OutingDestination, OutingLog } from "@/lib/sheets";

const OTHER_VALUE = "__other__";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowTimeString() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type FormMode = "add" | "return" | "edit";

type FormState = {
  mode: FormMode;
  id?: string;
  date: string;
  headcount: string; // kept as text while editing, parsed on submit
  departureTime: string;
  departureSign: string;
  returnTime: string;
  returnSign: string;
  description: string;
};

function blankAddForm(): FormState {
  return {
    mode: "add",
    date: todayDateString(),
    headcount: "",
    departureTime: nowTimeString(),
    departureSign: "",
    returnTime: "",
    returnSign: "",
    description: "",
  };
}

function toEditForm(entry: OutingLog, mode: FormMode): FormState {
  return {
    mode,
    id: entry.id,
    date: entry.date,
    headcount: String(entry.headcount),
    departureTime: entry.departureTime,
    departureSign: entry.departureSign,
    returnTime: mode === "return" ? nowTimeString() : entry.returnTime,
    returnSign: entry.returnSign,
    description: entry.description,
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

  // Registered destinations (school-wide, not month/class scoped) — loaded
  // once on mount, managed via a small add/delete list below the log.
  const [destinations, setDestinations] = useState<OutingDestination[]>([]);
  const [newDestinationName, setNewDestinationName] = useState("");
  const [addingDestination, setAddingDestination] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);

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
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, yearMonth]);

  const loadDestinations = useCallback(async () => {
    try {
      const res = await fetch("/api/outings/destinations");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setDestinations(data.destinations ?? []);
    } catch {
      // non-fatal — the "その他" free-text fallback still works either way
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    load();
    loadDestinations();
  }, [loaded, selectedClass, router, load, loadDestinations]);

  async function addDestination() {
    const name = newDestinationName.trim();
    if (!name) return;
    setAddingDestination(true);
    setDestinationError(null);
    try {
      const res = await fetch("/api/outings/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("failed");
      const { id } = await res.json();
      setDestinations((prev) => [...prev, { id, name }]);
      setNewDestinationName("");
    } catch {
      setDestinationError("追加に失敗しました / Failed to add");
    } finally {
      setAddingDestination(false);
    }
  }

  async function deleteDestination(destination: OutingDestination) {
    if (
      !window.confirm(
        `「${destination.name}」を削除しますか？\nDelete "${destination.name}"?`
      )
    ) {
      return;
    }
    setDestinationError(null);
    try {
      const res = await fetch(
        `/api/outings/destinations?id=${encodeURIComponent(destination.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("failed");
      setDestinations((prev) => prev.filter((d) => d.id !== destination.id));
    } catch {
      setDestinationError("削除に失敗しました / Failed to delete");
    }
  }

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
    setForm(blankAddForm());
  }

  function openReturnForm(entry: OutingLog) {
    setFormError(null);
    setForm(toEditForm(entry, "return"));
  }

  function openEditForm(entry: OutingLog) {
    setFormError(null);
    setForm(toEditForm(entry, "edit"));
  }

  async function submitForm() {
    if (!form || !selectedClass) return;
    const headcountNum = Number(form.headcount);

    if (form.mode === "add" || form.mode === "edit") {
      if (!form.date || !form.departureTime || !form.departureSign.trim()) {
        setFormError(
          "日付・退室時間・退室確認サインは必須です / Date, departure time, and departure sign are required"
        );
        return;
      }
      if (!Number.isFinite(headcountNum) || headcountNum < 0) {
        setFormError("人数を正しく入力してください / Please enter a valid headcount");
        return;
      }
    }
    if (form.mode === "return") {
      if (!form.returnTime || !form.returnSign.trim()) {
        setFormError(
          "入室時間と入室確認サインを入力してください / Please enter the return time and return sign"
        );
        return;
      }
    }

    setSaving(true);
    setFormError(null);
    const payload = {
      date: form.date,
      className: selectedClass,
      headcount: Math.floor(headcountNum),
      departureTime: form.departureTime,
      departureSign: form.departureSign.trim(),
      returnTime: form.returnTime,
      returnSign: form.returnSign.trim(),
      description: form.description,
    };
    try {
      const res = await fetch("/api/outings", {
        method: form.mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      });
      if (!res.ok) throw new Error("failed");
      setForm(null);
      await load();
    } catch {
      setFormError("保存に失敗しました / Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: OutingLog) {
    const label = entry.description ? `（${entry.description}）` : "";
    if (
      !window.confirm(
        `${entry.date} ${entry.departureTime} 退室の記録${label}を削除しますか？\nDelete the ${entry.date} ${entry.departureTime} departure record${entry.description ? ` (${entry.description})` : ""}?`
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
      setError("削除に失敗しました / Failed to delete");
    }
  }

  if (!loaded || !selectedClass) return null;

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass} 入退出記録</h1>
          <p className="text-xs text-gray-400">
            {classNameToEnglish(selectedClass)} · Entry/Exit Log
          </p>
          <p className="text-sm text-gray-500">
            行き先は登録済みのリストから選ぶか、自由入力できます
            <span className="block text-xs">
              Pick the destination from the registered list, or type your own
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
            <span className="block text-[10px] font-normal opacity-70">
              Back to attendance
            </span>
          </Link>
          <Link
            href="/select-class"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={goPrevMonth}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="前の月 / Previous month"
        >
          ◀
        </button>
        <p className="text-lg font-bold w-32 text-center">
          {year}年{month}月
        </p>
        <button
          onClick={goNextMonth}
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
          aria-label="次の月 / Next month"
        >
          ▶
        </button>
      </div>

      <button
        onClick={openAddForm}
        className="self-center rounded-full bg-green-600 text-white px-5 py-2.5 text-sm font-semibold"
      >
        ＋ 退室を記録
        <span className="block text-[10px] font-normal opacity-70">Record departure</span>
      </button>

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          この月の記録はまだありません
          <span className="block text-xs">No records yet this month</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl w-full mx-auto">
          {entries.map((entry) => {
            const isBack = entry.returnTime !== "";
            return (
              <div
                key={entry.id}
                className={`border rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${
                  isBack ? "border-gray-300" : "border-amber-400 bg-amber-50/50"
                }`}
              >
                <div>
                  <p className="font-semibold">
                    {entry.date}　{entry.headcount}人
                    {entry.description ? `　${entry.description}` : ""}
                  </p>
                  <p className="text-sm text-gray-600">
                    退室 {entry.departureTime}
                    {entry.departureSign ? `（${entry.departureSign}）` : ""}
                    {"　"}
                    {isBack ? (
                      <>
                        入室 {entry.returnTime}
                        {entry.returnSign ? `（${entry.returnSign}）` : ""}
                      </>
                    ) : (
                      <span className="text-amber-700 font-semibold">未入室 / Not back yet</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isBack && (
                    <button
                      onClick={() => openReturnForm(entry)}
                      className="rounded-full bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold"
                    >
                      入室を記録
                      <span className="block text-[9px] font-normal opacity-80">
                        Record return
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => openEditForm(entry)}
                    className="rounded-full bg-gray-100 text-gray-600 px-3 py-1.5 text-xs font-semibold"
                  >
                    編集 / Edit
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    className="rounded-full border border-red-300 text-red-600 px-3 py-1.5 text-xs font-semibold"
                  >
                    削除 / Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border rounded-xl p-4 max-w-2xl w-full mx-auto flex flex-col gap-3">
        <h2 className="font-semibold text-sm text-gray-700">
          行き先の登録リスト
          <span className="block text-xs font-normal text-gray-400">
            Registered destinations (shared by both branches)
          </span>
        </h2>
        {destinations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {destinations.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 pl-3 pr-1.5 py-1 text-sm"
              >
                {d.name}
                <button
                  onClick={() => deleteDestination(d)}
                  aria-label={`${d.name}を削除`}
                  className="text-gray-400 hover:text-red-500 px-1"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newDestinationName}
            onChange={(e) => setNewDestinationName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addDestination();
            }}
            placeholder="新しい行き先（例：近所の公園）/ New destination"
            disabled={addingDestination}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm flex-1"
          />
          <button
            onClick={addDestination}
            disabled={addingDestination || !newDestinationName.trim()}
            className="rounded-full bg-green-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40 shrink-0"
          >
            ＋ 追加 / Add
          </button>
        </div>
        {destinationError && <p className="text-red-600 text-sm">{destinationError}</p>}
      </div>

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
              {form.mode === "add" && (
                <>
                  退室を記録
                  <span className="block text-sm font-normal text-gray-500">
                    Record departure
                  </span>
                </>
              )}
              {form.mode === "return" && (
                <>
                  入室を記録
                  <span className="block text-sm font-normal text-gray-500">Record return</span>
                </>
              )}
              {form.mode === "edit" && (
                <>
                  記録を編集
                  <span className="block text-sm font-normal text-gray-500">Edit record</span>
                </>
              )}
            </h2>

            {form.mode !== "return" && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  日付
                  <span className="text-xs font-normal text-gray-500">Date</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => (f ? { ...f, date: e.target.value } : f))}
                    className="border border-gray-300 rounded-lg px-3 py-2"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  人数
                  <span className="text-xs font-normal text-gray-500">Headcount</span>
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
                    退室時間
                    <span className="text-xs font-normal text-gray-500">Departure time</span>
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
                    退室確認サイン
                    <span className="text-xs font-normal text-gray-500">Departure sign</span>
                    <input
                      type="text"
                      value={form.departureSign}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, departureSign: e.target.value } : f))
                      }
                      placeholder="名前 / Name"
                      className="border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-sm">
                  行き先・内容（任意）
                  <span className="text-xs font-normal text-gray-500">
                    Destination/notes (optional)
                  </span>
                  <select
                    value={
                      form.description === ""
                        ? ""
                        : destinations.some((d) => d.name === form.description)
                          ? form.description
                          : OTHER_VALUE
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === OTHER_VALUE) {
                        // switching to free-input — clear only if the current
                        // description was itself a picked-from-list value
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                description: destinations.some((d) => d.name === f.description)
                                  ? ""
                                  : f.description,
                              }
                            : f
                        );
                      } else {
                        setForm((f) => (f ? { ...f, description: value } : f));
                      }
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
                  >
                    <option value="">選択なし / None</option>
                    {destinations.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                    <option value={OTHER_VALUE}>その他（自由入力） / Other (type your own)</option>
                  </select>
                  {(form.description === "" ||
                    !destinations.some((d) => d.name === form.description)) && (
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, description: e.target.value } : f))
                      }
                      placeholder="例：近所の公園"
                      className="border border-gray-300 rounded-lg px-3 py-2 mt-1"
                    />
                  )}
                </label>
              </>
            )}

            {(form.mode === "return" || form.mode === "edit") && (
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 text-sm flex-1">
                  入室時間
                  <span className="text-xs font-normal text-gray-500">Return time</span>
                  <input
                    type="time"
                    value={form.returnTime}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, returnTime: e.target.value } : f))
                    }
                    className="border border-gray-300 rounded-lg px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm flex-1">
                  入室確認サイン
                  <span className="text-xs font-normal text-gray-500">Return sign</span>
                  <input
                    type="text"
                    value={form.returnSign}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, returnSign: e.target.value } : f))
                    }
                    placeholder="名前 / Name"
                    className="border border-gray-300 rounded-lg px-3 py-2"
                  />
                </label>
              </div>
            )}

            {formError && <p className="text-red-600 text-sm">{formError}</p>}

            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => setForm(null)}
                disabled={saving}
                className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={submitForm}
                disabled={saving}
                className="rounded-full bg-green-600 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                {saving ? "保存中... / Saving..." : "保存する / Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
