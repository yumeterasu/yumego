"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("パスワードが違います");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      router.replace(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 w-full max-w-xs"
      >
        <h1 className="text-xl font-bold text-center">Yumego</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          className="border rounded px-3 py-3 text-center text-lg"
          autoFocus
          required
        />
        <button
          type="submit"
          disabled={submitting || !password}
          className="rounded-full bg-black text-white py-3 font-semibold disabled:opacity-40"
        >
          {submitting ? "確認中..." : "ログイン"}
        </button>
        {error && (
          <p className="text-red-600 text-sm text-center">{error}</p>
        )}
      </form>
    </main>
  );
}
