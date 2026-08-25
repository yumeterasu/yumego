"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ExtraClass } from "@/lib/sheets";

type Branch = "プロンポン" | "トンロー";
type Editing = { id: string | null; branch: Branch; suffix: string; nameEn: string };

export default function ClassManagementPage() {
  const [classes, setClasses] = useState<ExtraClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/extra-classes");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setClasses(data.classes ?? []);
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
    setEditing({ id: null, branch: "プロンポン", suffix: "", nameEn: "" });
  }
  function openEdit(c: ExtraClass) {
    setEditing({ id: c.id, branch: c.branch, suffix: c.suffix, nameEn: c.nameEn });
  }

  async function saveEditing() {
    if (!editing || !editing.suffix.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) {
        const res = await fetch("/api/extra-classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch: editing.branch,
            suffix: editing.suffix.trim(),
            nameEn: editing.nameEn.trim(),
          }),
        });
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setClasses((prev) => [
          ...prev,
          {
            id: data.id,
            branch: editing.branch,
            suffix: editing.suffix.trim(),
            nameEn: editing.nameEn.trim(),
            active: true,
          },
        ]);
      } else {
        const res = await fetch("/api/extra-classes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing.id,
            suffix: editing.suffix.trim(),
            nameEn: editing.nameEn.trim(),
          }),
        });
        if (!res.ok) throw new Error("failed");
        setClasses((prev) =>
          prev.map((c) =>
            c.id === editing.id
              ? { ...c, suffix: editing.suffix.trim(), nameEn: editing.nameEn.trim() }
              : c
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

  async function toggleActive(c: ExtraClass) {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch("/api/extra-classes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, active: !c.active }),
      });
      if (!res.ok) throw new Error("failed");
      setClasses((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
      setConfirmDeactivateId(null);
    } catch {
      setError("更新に失敗しました / Failed to update");
    } finally {
      setToggling(false);
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">クラス管理</h1>
          <p className="text-xs text-gray-400">Class Management</p>
          <p className="text-sm text-gray-500">
            年少・年中・年長以外の追加クラス（例：小学生）を管理します
            <span className="block text-xs">
              Manage classes outside the fixed 年少/年中/年長 continuum (e.g. 小学生)
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
          {classes.map((c) => (
            <div
              key={c.id}
              className={`border rounded-xl p-4 flex items-center justify-between gap-3 ${
                c.active ? "border-gray-300" : "border-gray-200 bg-gray-50 opacity-60"
              }`}
            >
              <div>
                <p className="font-semibold">
                  {c.branch}　{c.suffix}
                </p>
                <p className="text-xs text-gray-400">{c.nameEn}</p>
                <span
                  className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border ${
                    c.active
                      ? "bg-green-50 text-green-700 border-green-300"
                      : "bg-gray-100 text-gray-500 border-gray-300"
                  }`}
                >
                  {c.active ? "有効 / Active" : "無効（非表示） / Inactive"}
                </span>
              </div>
              {confirmDeactivateId === c.id ? (
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <p className="text-xs text-red-600 font-semibold text-right">
                    トップページから
                    <br />
                    非表示にしますか？
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDeactivateId(null)}
                      disabled={toggling}
                      className="rounded-full bg-gray-100 text-gray-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={toggling}
                      className="rounded-full bg-red-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    >
                      無効にする
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(c)}
                    className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center"
                    aria-label="編集 / Edit"
                  >
                    ✏️
                  </button>
                  {c.active ? (
                    <button
                      onClick={() => setConfirmDeactivateId(c.id)}
                      className="rounded-full bg-red-50 text-red-600 w-9 h-9 flex items-center justify-center"
                      aria-label="無効にする / Deactivate"
                    >
                      🚫
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={toggling}
                      className="rounded-full bg-green-50 text-green-700 w-9 h-9 flex items-center justify-center disabled:opacity-40"
                      aria-label="有効にする / Activate"
                    >
                      ✅
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <button
            onClick={openAdd}
            className="rounded-xl border-2 border-dashed border-gray-300 text-gray-500 py-4 font-semibold hover:bg-gray-50"
          >
            ＋ 新しいクラスを追加
            <span className="block text-xs font-normal opacity-70">Add new class</span>
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
              {editing.id === null ? "新しいクラスを追加" : "クラスを編集"}
              <span className="block text-sm font-normal text-gray-500">
                {editing.id === null ? "Add new class" : "Edit class"}
              </span>
            </h2>
            <div className="flex flex-col gap-1 text-sm">
              校舎
              <span className="text-xs font-normal text-gray-500">Branch</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={editing.id !== null}
                  onClick={() => setEditing({ ...editing, branch: "プロンポン" })}
                  className={`rounded-full border py-2 text-sm font-semibold disabled:opacity-50 ${
                    editing.branch === "プロンポン"
                      ? "bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-500"
                      : "bg-white border-gray-300 text-gray-500"
                  }`}
                >
                  プロンポン
                </button>
                <button
                  type="button"
                  disabled={editing.id !== null}
                  onClick={() => setEditing({ ...editing, branch: "トンロー" })}
                  className={`rounded-full border py-2 text-sm font-semibold disabled:opacity-50 ${
                    editing.branch === "トンロー"
                      ? "bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-500"
                      : "bg-white border-gray-300 text-gray-500"
                  }`}
                >
                  トンロー
                </button>
              </div>
              {editing.id !== null && (
                <p className="text-[10px] text-gray-400">
                  校舎は作成後に変更できません / Branch can't be changed after creation
                </p>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              クラス名（日本語）
              <span className="text-xs font-normal text-gray-500">
                Class name (Japanese) — shown as {editing.branch}　{editing.suffix || "..."}
              </span>
              <input
                type="text"
                value={editing.suffix}
                onChange={(e) => setEditing({ ...editing, suffix: e.target.value })}
                placeholder="例：小学生"
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              英語名
              <span className="text-xs font-normal text-gray-500">English</span>
              <input
                type="text"
                value={editing.nameEn}
                onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                placeholder="e.g. Elementary School"
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
                disabled={saving || !editing.suffix.trim()}
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
