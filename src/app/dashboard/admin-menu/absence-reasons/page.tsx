"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AbsenceReason } from "@/lib/sheets";

type Editing = { id: string | null; label: string; en: string; status: "absent" | "suspended" };

export default function AbsenceReasonsSettingsPage() {
  const [reasons, setReasons] = useState<AbsenceReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/absence-reasons");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setReasons(data.reasons ?? []);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing({ id: null, label: "", en: "", status: "absent" });
  }
  function openEdit(r: AbsenceReason) {
    setEditing({ id: r.id, label: r.label, en: r.en, status: r.status });
  }

  async function saveEditing() {
    if (!editing || !editing.label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) {
        const res = await fetch("/api/absence-reasons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: editing.label.trim(), en: editing.en.trim(), status: editing.status }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setReasons((prev) => [
          ...prev,
          { id: data.id, label: editing.label.trim(), en: editing.en.trim(), status: editing.status },
        ]);
      } else {
        const res = await fetch("/api/absence-reasons", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            label: editing.label.trim(),
            en: editing.en.trim(),
            status: editing.status,
          }),
        });
        if (!res.ok) throw new Error("failed");
        setReasons((prev) =>
          prev.map((r) =>
            r.id === editing.id
              ? { ...r, label: editing.label.trim(), en: editing.en.trim(), status: editing.status }
              : r
          )
        );
      }
      setEditing(null);
    } catch {
      setError("保存に失敗しました / Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/absence-reasons?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("failed");
      setReasons((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
    } catch {
      setError("削除に失敗しました / Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">欠席理由設定</h1>
          <p className="text-xs text-gray-400">Absence Reason Settings</p>
          <p className="text-sm text-gray-500">
            出席確認・出席簿で選べる欠席理由の一覧です。学校全体で共有されます
            <span className="block text-xs">
              School-wide list of quick-pick absence reasons, used on the check-in page and
              Dashboard
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/admin-menu"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 戻る
            <span className="block text-[10px] font-normal opacity-70">Back</span>
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

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : (
        <div className="flex flex-col gap-3">
          {reasons.map((r) => (
            <div
              key={r.id}
              className="border border-gray-300 rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <div>
                <p className="font-semibold">{r.label}</p>
                <p className="text-xs text-gray-400">{r.en}</p>
                <span
                  className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border ${
                    r.status === "suspended"
                      ? "bg-purple-50 text-purple-700 border-purple-300"
                      : "bg-red-50 text-red-700 border-red-300"
                  }`}
                >
                  {r.status === "suspended" ? "出席停止 / Suspended" : "欠席 / Absent"}
                </span>
              </div>
              {confirmDeleteId === r.id ? (
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <p className="text-xs text-red-600 font-semibold">削除しますか？</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deleting}
                      className="rounded-full bg-gray-100 text-gray-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={deleting}
                      className="rounded-full bg-red-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    >
                      削除する
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(r)}
                    className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
                    aria-label="編集 / Edit"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(r.id)}
                    className="rounded-full bg-red-50 text-red-600 w-9 h-9 flex items-center justify-center"
                    aria-label="削除 / Delete"
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={openAdd}
            className="rounded-xl border-2 border-dashed border-gray-300 text-gray-500 py-4 font-semibold hover:bg-gray-50"
          >
            ＋ 新しい理由を追加
            <span className="block text-xs font-normal opacity-70">Add new reason</span>
          </button>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {editing.id === null ? "新しい理由を追加" : "理由を編集"}
              <span className="block text-sm font-normal text-gray-500">
                {editing.id === null ? "Add new reason" : "Edit reason"}
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              名前（日本語）
              <span className="text-xs font-normal text-gray-500">Label (Japanese)</span>
              <input
                type="text"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="例：都合欠"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              英語名
              <span className="text-xs font-normal text-gray-500">English</span>
              <input
                type="text"
                value={editing.en}
                onChange={(e) => setEditing({ ...editing, en: e.target.value })}
                placeholder="e.g. Personal reasons"
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              区分
              <span className="text-xs font-normal text-gray-500">Category</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, status: "absent" })}
                  className={`rounded-full border py-2 text-sm font-semibold ${
                    editing.status === "absent"
                      ? "bg-red-50 border-red-400 text-red-700 ring-2 ring-red-500"
                      : "bg-white border-gray-300 text-gray-500"
                  }`}
                >
                  欠席 / Absent
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, status: "suspended" })}
                  className={`rounded-full border py-2 text-sm font-semibold ${
                    editing.status === "suspended"
                      ? "bg-purple-50 border-purple-400 text-purple-700 ring-2 ring-purple-500"
                      : "bg-white border-gray-300 text-gray-500"
                  }`}
                >
                  出席停止 / Suspended
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={saveEditing}
                disabled={saving || !editing.label.trim()}
                className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
