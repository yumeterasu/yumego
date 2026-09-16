// Client-side fetch wrapper that tells apart "the request itself failed"
// from "the session expired and got redirected to /login". A generic
// retry can't fix the second case (it will just get redirected again),
// so callers should show a different message and prompt a full page
// reload instead of calling their loader function again.

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.redirected && new URL(res.url, window.location.href).pathname === "/login") {
    throw new SessionExpiredError();
  }
  return res;
}
