import { publicEnv } from "@/lib/env";

/**
 * Where an emailed auth link must come back to.
 *
 * THE DEPLOYMENT DECIDES BEFORE THE VARIABLE DOES, and the order matters more
 * than it looks. Vercel sets an environment variable for every environment
 * unless it is explicitly scoped, so a Preview build inherits Production's
 * `NEXT_PUBLIC_SITE_URL` by default. Consulting that first meant a reset
 * requested ON a preview mailed a link back to PRODUCTION — the preview could
 * never be accepted on its own, and worse, a tester's click would land on the
 * live site and change a live password.
 *
 * So a preview deployment answers for itself first, and only then does a
 * deliberate configured value apply.
 *
 * NOT DERIVED FROM THE REQUEST HOST. `Host` and `X-Forwarded-Host` are headers;
 * an attacker offers any value they like, and a Supabase allow list holding a
 * wildcard would accept a neighbouring domain — turning a genuine
 * password-reset email into a delivery mechanism for somebody else's site.
 * Every input below is set by the platform at build time and cannot be
 * influenced by a request.
 *
 * Supabase's redirect allow list remains the real boundary on where a link may
 * point. This only decides what the app asks for.
 */

export interface AuthOriginEnv {
  /** `NEXT_PUBLIC_SITE_URL` — a deliberate choice, when it is one. */
  siteUrl: string | undefined;
  /** `VERCEL_ENV` — "production" | "preview" | "development". */
  vercelEnv: string | undefined;
  /** `VERCEL_URL` — this exact deployment, preview or otherwise. */
  vercelUrl: string | undefined;
  /** `VERCEL_PROJECT_PRODUCTION_URL` — the project's production domain. */
  productionUrl: string | undefined;
}

const LOCALHOST = "http://localhost:3000";

/**
 * Pure, so the precedence can be tested exhaustively rather than reasoned
 * about — this is the kind of ordering that looks obviously right in a diff and
 * is obviously wrong in an inbox.
 */
export function resolveAuthOrigin(env: AuthOriginEnv): string {
  const site = clean(env.siteUrl);

  /**
   * 1. A PREVIEW ANSWERS FOR ITSELF, whatever it inherited.
   *
   * This is the whole correction: an inherited production URL must not be able
   * to redirect a preview's reset email onto the live site.
   */
  if (env.vercelEnv === "preview" && env.vercelUrl) {
    return `https://${trimHost(env.vercelUrl)}`;
  }

  /**
   * 2. A deliberate, non-localhost value — production's configured domain,
   *    including a custom one the platform variables know nothing about.
   *
   * A localhost value on a deployed environment is a leftover rather than a
   * decision, so it does not qualify and the platform's own domain wins below.
   */
  if (site && !isLocal(site)) return site;

  // 3. The project's production domain.
  if (env.productionUrl) return `https://${trimHost(env.productionUrl)}`;

  // 4. Any other deployment that named itself.
  if (env.vercelUrl) return `https://${trimHost(env.vercelUrl)}`;

  // 5. Local development, where localhost is exactly right.
  return site || LOCALHOST;
}

/** Reads only platform-set values. No request, no headers, no cookies. */
export function authRedirectOrigin(): string {
  return resolveAuthOrigin({
    siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

function clean(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/** Vercel supplies a bare host; tolerate a scheme if one is ever added. */
function trimHost(host: string): string {
  return host.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function isLocal(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}
