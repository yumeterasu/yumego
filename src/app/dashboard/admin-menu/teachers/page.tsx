"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Teacher } from "@/lib/sheets";

type Editing = { id: string | null; name: string };

export default function TeachersSettingsPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
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
      const res = await fetch("/api/teachers");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setTeachers(data.teachers ?? []);
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
    setEditing({ id: null, name: "" });
  }
  function openEdit(t: Teacher) {
    setEditing({ id: t.id, name: t.name });
  }

  async function saveEditing() {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) {
        const res = await fetch("/api/teachers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editing.name.trim() }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setTeachers((prev) => [...prev, { id: data.id, name: editing.name.trim() }]);
      } else {
        const res = await fetch("/api/teachers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, name: editing.name.trim() }),
        });
        if (!res.ok) throw new Error("failed");
        setTeachers((prev) =>
          prev.map((t) => (t.id === editing.id ? { ...t, name: editing.name.trim() } : t))
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
      const res = await fetch(`/api/teachers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      setTeachers((prev) => prev.filter((t) => t.id !== id));
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
          <h1 className="text-xl font-bold">先生登録</h1>
          <p className="text-xs text-gray-400">Teacher Registration</p>
          <p className="text-sm text-gray-500">
            先生の名前を登録します。お出かけ記録などでリストから選べるようになります
            <span className="block text-xs">
              Register teacher names — they can then be picked from a list in places like the
              outing log instead of typed by hand
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

      {error && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-600 text-sm text-center">{error}</p>
          <button
            onClick={() => load()}
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-1.5 text-xs font-semibold"
          >
            🔄 再読み込み
            <span className="block text-[9px] font-normal opacity-70">Retry</span>
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm text-center">読み込み中... / Loading...</p>
      ) : (
        <div className="flex flex-col gap-3">
          {teachers.map((t) => (
            <div
              key={t.id}
              className="border border-gray-300 rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <p className="font-semibold text-lg">{t.name}</p>
              {confirmDeleteId === t.id ? (
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
                      onClick={() => handleDelete(t.id)}
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
                    onClick={() => openEdit(t)}
                    className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
                    aria-label="編集 / Edit"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(t.id)}
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
            ＋ 新しい先生を追加
            <span className="block text-xs font-normal opacity-70">Add new teacher</span>
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
              {editing.id === null ? "新しい先生を追加" : "先生を編集"}
              <span className="block text-sm font-normal text-gray-500">
                {editing.id === null ? "Add new teacher" : "Edit teacher"}
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              先生の名前
              <span className="text-xs font-normal text-gray-500">Teacher name</span>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例：山田先生"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
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
