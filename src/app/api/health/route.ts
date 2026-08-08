import { NextResponse } from "next/server";

/**
 * Deployment health + version marker.
 *
 * Exists because "which commit is actually live?" was unanswerable during a
 * schema rename, and that turned a five-minute diagnosis into a long one. When
 * the database has moved ahead of the deployed code, every authenticated page
 * 500s while public routes look fine — this endpoint makes that obvious.
 *
 * Deliberately exposes NOTHING sensitive: a commit SHA, a branch name and a
 * region. No env values, no keys, no database reachability probe (that would
 * let anyone trigger load against Supabase).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
      env: process.env.VERCEL_ENV ?? "development",
      region: process.env.VERCEL_REGION ?? null,
      builtAt: process.env.VERCEL_DEPLOYMENT_ID ? undefined : "dev",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
