import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, checkPassword, createAuthToken } from "@/lib/auth";
import { isBlocked, recordFailure, recordSuccess } from "@/lib/rateLimit";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clientKey(req: NextRequest): string {
  // Best-effort caller identifier for rate limiting.
  return req.headers.get("x-forwarded-for") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);

  if (isBlocked(key)) {
    return NextResponse.json(
      { error: "試行回数が多すぎます。しばらくしてから再度お試しください" },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;

  // Small artificial delay on every attempt slows down automated guessing.
  await sleep(500 + Math.random() * 500);

  if (typeof password !== "string" || !(await checkPassword(password))) {
    recordFailure(key);
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  recordSuccess(key);

  const token = await createAuthToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days — tablets stay logged in
  });
  return res;
}
