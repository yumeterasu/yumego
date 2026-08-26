"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CLASSES, classNameToEnglish } from "@/lib/classes";
import { useExtraClasses } from "@/hooks/useExtraClasses";
import {
  CLASS_COLOR_OPTIONS,
  CLASS_COLOR_CARD_STYLES,
  CLASS_COLOR_DEFAULT_CARD_STYLE,
  CLASS_COLOR_SWATCH_STYLES,
  isClassColorKey,
} from "@/lib/classColors";

export default function ClassColorsPage() {
  const { activeClasses, enNames: extraClassEnNames } = useExtraClasses();
  const [colors, setColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingClass, setSavingClass] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/class-colors");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const c of data.colors ?? []) map[c.className] = c.color;
      setColors(map);
    } catch {
      setError("データの取得に失敗しました / Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function pickColor(className: string, color: string | null) {
    // Picking the already-set color again resets it to default.
    const nextColor = colors[className] === color ? null : color;
    setSavingClass(className);
    setError(null);
    try {
      const res = await fetch("/api/class-colors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className, color: nextColor }),
      });
      if (!res.ok) throw new Error("failed");
      setColors((prev) => {
        const next = { ...prev };
        if (nextColor === null) delete next[className];
        else next[className] = nextColor;
        return next;
      });
    } catch {
      setError("保存に失敗しました / Failed to save");
    } finally {
      setSavingClass(null);
    }
  }

  const allClasses = [
    ...CLASSES,
    ...activeClasses.map((c) => `${c.branch}　${c.suffix}`),
  ];

  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">クラスの色</h1>
          <p className="text-xs text-gray-400">Class Colors</p>
          <p className="text-sm text-gray-500">
            トップページのクラスボタンの色を選べます
            <span className="block text-xs">Choose each class button's color on the top page</span>
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
          {allClasses.map((name) => {
            const colorKey = colors[name];
            const preview =
              colorKey && isClassColorKey(colorKey)
                ? CLASS_COLOR_CARD_STYLES[colorKey]
                : CLASS_COLOR_DEFAULT_CARD_STYLE;
            return (
              <div key={name} className="border rounded-xl p-3 flex flex-col gap-2">
                <div
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${preview}`}
                >
                  {name}
                  <span className="block text-[10px] font-normal opacity-70">
                    {classNameToEnglish(name, extraClassEnNames)}
                  </span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {CLASS_COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      onClick={() => pickColor(name, c)}
                      disabled={savingClass === name}
                      aria-label={c}
                      className={`w-7 h-7 rounded-full ${CLASS_COLOR_SWATCH_STYLES[c]} disabled:opacity-40 ${
                        colorKey === c ? "ring-2 ring-offset-2 ring-gray-700" : ""
                      }`}
                    />
                  ))}
                  <button
                    onClick={() => pickColor(name, null)}
                    disabled={savingClass === name || !colorKey}
                    className="px-3 h-7 rounded-full border border-gray-300 text-[11px] text-gray-500 disabled:opacity-30"
                  >
                    リセット / None
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
