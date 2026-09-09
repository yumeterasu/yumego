"use client";

import { useEffect, useState } from "react";

// Client-side (Link) navigation in this app never does a full page reload --
// it fetches only the new route's data over the network, but keeps running
// whatever JS the browser already loaded for shared code. Combined with
// tablets staying logged in for up to 90 days (see AUTH_COOKIE maxAge) and
// a service worker caching static assets, a tab left open across a deploy
// can keep running old code indefinitely with nothing ever prompting a
// real reload. This polls /api/version (always the currently-running
// deploy's own commit, set fresh by Vercel on every deploy) against the
// commit baked into the JS this tab already has loaded, and asks the user
// to refresh once they've drifted apart -- reloading always works to pick
// up the new version, since navigations already fetch fresh HTML/JS
// (network-first) per the service worker's own caching strategy.
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function VersionWatcher() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const builtVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (!builtVersion || builtVersion === "dev") return; // local dev -- nothing to compare against

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.version && data.version !== builtVersion) {
          setOutdated(true);
        }
      } catch {
        // offline or a transient error -- just try again next tick
      }
    }

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibility);

    function handleVisibility() {
      if (document.visibilityState === "visible") check();
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (!outdated) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[200] flex justify-center p-3 print:hidden">
      <div className="bg-gray-900 text-white rounded-full shadow-lg pl-4 pr-1.5 py-1.5 flex items-center gap-3 text-sm">
        <span>
          🆕 新しいバージョンがあります
          <span className="block text-[10px] font-normal opacity-70">
            A new version is available
          </span>
        </span>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-white text-gray-900 px-4 py-1.5 font-semibold text-xs shrink-0"
        >
          更新する
          <span className="block text-[9px] font-normal opacity-70">Refresh</span>
        </button>
      </div>
    </div>
  );
}
