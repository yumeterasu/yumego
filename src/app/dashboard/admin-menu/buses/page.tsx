"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Bus } from "@/lib/sheets";

type Editing = { id: string | null; name: string; emoji: string };

const EMOJI_SUGGESTIONS = [
  // Already-common picks first
  "🐶", "🐱", "🐰", "🐻", "🐼", "🐨",
  "🦁", "🐯", "🐵", "🐸", "🐘", "🦒",
  "🦊", "🐷", "🐮", "🐔", "🐐", "🐧",
  // Every other standard animal emoji
  "🐭", "🐹", "🐺", "🐗", "🐴", "🦄",
  "🐝", "🐛", "🦋", "🐌", "🐞", "🐜",
  "🦟", "🦗", "🕷️", "🦂", "🐢", "🐍",
  "🦎", "🦖", "🦕", "🐙", "🦑", "🦐",
  "🦞", "🦀", "🐡", "🐠", "🐟", "🐬",
  "🐳", "🐋", "🦈", "🐊", "🐅", "🐆",
  "🦓", "🦍", "🦧", "🦣", "🦛", "🦏",
  "🐪", "🐫", "🦘", "🦬", "🐃", "🐂",
  "🐄", "🐎", "🐖", "🐏", "🐑", "🦙",
  "🦌", "🐕", "🐩", "🐈", "🐓", "🦃",
  "🦤", "🦚", "🦜", "🦢", "🦩", "🕊️",
  "🐇", "🦝", "🦨", "🦡", "🦫", "🦦",
  "🦥", "🐁", "🐀", "🐿️", "🦔", "🐦",
  "🐤", "🐣", "🐥", "🦆", "🦅", "🦉",
  "🦇",
];

export default function BusesSettingsPage() {
  const [buses, setBuses] = useState<Bus[]>([]);
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
      const res = await fetch("/api/buses");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setBuses(data.buses ?? []);
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
    setEditing({ id: null, name: "", emoji: "" });
  }
  function openEdit(b: Bus) {
    setEditing({ id: b.id, name: b.name, emoji: b.emoji });
  }

  async function saveEditing() {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) {
        const res = await fetch("/api/buses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editing.name.trim(), emoji: editing.emoji.trim() }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setBuses((prev) => [
          ...prev,
          { id: data.id, name: editing.name.trim(), emoji: editing.emoji.trim() },
        ]);
      } else {
        const res = await fetch("/api/buses", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, name: editing.name.trim(), emoji: editing.emoji.trim() }),
        });
        if (!res.ok) throw new Error("failed");
        setBuses((prev) =>
          prev.map((b) =>
            b.id === editing.id ? { ...b, name: editing.name.trim(), emoji: editing.emoji.trim() } : b
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
      const res = await fetch(`/api/buses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setBuses((prev) => prev.filter((b) => b.id !== id));
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
          <h1 className="text-xl font-bold">バス管理</h1>
          <p className="text-xs text-gray-400">Bus Management</p>
          <p className="text-sm text-gray-500">
            バスの名前を登録します。絵文字マークは任意です
            <span className="block text-xs">Register bus names. An emoji mark is optional</span>
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
          {buses.map((b) => (
            <div
              key={b.id}
              className="border border-gray-300 rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <p className="font-semibold text-lg">
                {b.emoji && <span className="mr-2">{b.emoji}</span>}
                {b.name}
              </p>
              {confirmDeleteId === b.id ? (
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
                      onClick={() => handleDelete(b.id)}
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
                    onClick={() => openEdit(b)}
                    className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
                    aria-label="編集 / Edit"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(b.id)}
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
            ＋ 新しいバスを追加
            <span className="block text-xs font-normal opacity-70">Add new bus</span>
          </button>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !saving && setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {editing.id === null ? "新しいバスを追加" : "バスを編集"}
              <span className="block text-sm font-normal text-gray-500">
                {editing.id === null ? "Add new bus" : "Edit bus"}
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              バス名
              <span className="text-xs font-normal text-gray-500">Bus name</span>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例：バスA"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              絵文字マーク（任意）
              <span className="text-xs font-normal text-gray-500">Emoji mark (optional)</span>
              <input
                type="text"
                value={editing.emoji}
                onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}
                placeholder="🐶"
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
              <div className="flex gap-2 flex-wrap mt-1 max-h-40 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                {EMOJI_SUGGESTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEditing({ ...editing, emoji: e })}
                    className={`w-9 h-9 rounded-full border flex items-center justify-center text-lg ${
                      editing.emoji === e
                        ? "border-blue-400 bg-blue-50 ring-2 ring-blue-400"
                        : "border-gray-300"
                    }`}
                  >
                    {e}
                  </button>
                ))}
                {editing.emoji && (
                  <button
                    type="button"
                    onClick={() => setEditing({ ...editing, emoji: "" })}
                    className="px-3 h-9 rounded-full border border-gray-300 text-xs text-gray-500"
                  >
                    なし / None
                  </button>
                )}
              </div>
            </label>
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
                disabled={saving || !editing.name.trim()}
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
