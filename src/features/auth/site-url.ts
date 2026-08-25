import "server-only";
import { publicEnv } from "@/lib/env";

/**
 * Where an emailed auth link must come back to.
 *
 * This was `NEXT_PUBLIC_SITE_URL` alone, and in this repository that value is
 * `http://localhost:3000`. A deployment where the variable is unset — or set
 * once and never revisited — mails out links pointing at the developer's own
 * machine, and Supabase quietly substitutes the project Site URL because the
 * host is not on its allow list. Either way the link the doctor receives is not
 * the link the code intended to send.
 *
 * NOT DERIVED FROM THE REQUEST HOST. `Host` is a header, an attacker can offer
 * any value, and a Supabase allow list with a wildcard would happily accept a
 * neighbouring domain — turning a genuine password-reset email into a delivery
 * mechanism for somebody else's site. The values below are set by the platform
 * and cannot be influenced by a request:
 *
 *   NEXT_PUBLIC_SITE_URL           an explicit, deliberate override
 *   VERCEL_PROJECT_PRODUCTION_URL  this project's production domain
 *   VERCEL_URL                     this exact deployment (so previews work)
 *
 * Supabase's redirect allow list remains the real boundary on where a link may
 * point. This only decides what we ask for.
 */
export function authRedirectOrigin(): string {
  const explicit = publicEnv().NEXT_PUBLIC_SITE_URL;

  /**
   * An explicit non-localhost value wins: someone chose it. A localhost value
   * on a deployed environment is a leftover, not a decision, so the platform's
   * own domain is preferred over it there.
   */
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(explicit);
  if (explicit && !isLocal) return trim(explicit);

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const deployment = process.env.VERCEL_URL;

  /**
   * On a PREVIEW deployment the link must return to that preview, or it is
   * untestable. On production both variables point at the same place.
   */
  if (process.env.VERCEL_ENV === "preview" && deployment) return `https://${deployment}`;
  if (production) return `https://${production}`;
  if (deployment) return `https://${deployment}`;

  // Local development, where localhost is exactly right.
  return trim(explicit);
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}
