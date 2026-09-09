import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    // Vercel sets this automatically on every deploy (the commit being
    // built) -- exposing it to the client here bakes the CURRENT build's
    // commit into the JS bundle at build time. VersionWatcher compares it
    // against /api/version's live value (read fresh from the currently
    // *running* serverless functions) to notice when a newer deploy has
    // gone out while this tab has stayed open. Falls back to a fixed
    // string locally, where this var isn't set.
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
