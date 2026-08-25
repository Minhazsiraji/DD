import type { Metadata } from "next";
import { ConfirmLink } from "@/features/auth/components/confirm-link";

export const metadata: Metadata = {
  title: "Opening your link",
  robots: { index: false, follow: false },
};

/**
 * Where every emailed auth link lands.
 *
 * A PAGE, not a route handler, and that is the entire fix. Supabase hands the
 * result of `/auth/v1/verify` back in one of three shapes, and only two of them
 * are visible to a server:
 *
 *   ?code=…                     PKCE      server can exchange it
 *   ?token_hash=…&type=…        OTP       server can verify it
 *   #access_token=…&type=…      implicit  A FRAGMENT — NEVER SENT TO THE SERVER
 *
 * This project's own links were traced and come back as the third: tokens, or
 * an error, in the fragment. A route handler receives nothing of it at all,
 * which is why a perfectly valid link died at the door.
 *
 * So the page renders, and a client component reads what only a browser can
 * see. Nothing about verification is relaxed — every shape is still handed to
 * Supabase to check, and a token this app cannot verify remains a token this
 * app refuses.
 */
export default function ConfirmPage() {
  return <ConfirmLink />;
}
