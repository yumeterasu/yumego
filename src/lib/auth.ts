// Simple site-wide password protection.
// The auth cookie stores SHA-256(password + secret) so the raw password
// is never stored in the cookie itself. Works in both the Node.js and
// Edge runtimes since it only uses the Web Crypto API (no `Buffer`).

export const AUTH_COOKIE_NAME = "yumego_auth";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeToken(password: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(digest);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  return !!expected && candidate === expected;
}

export async function createAuthToken(): Promise<string> {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) {
    throw new Error("Missing APP_PASSWORD or SESSION_SECRET env vars");
  }
  return computeToken(password, secret);
}

export async function isValidAuthToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await createAuthToken();
  return token === expected;
}
