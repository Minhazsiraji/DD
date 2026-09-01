import { NextResponse, type NextRequest } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import { createDocumentUrl } from "@/features/documents/queries";
import { logDocumentViewAction } from "@/features/documents/actions";

/**
 * Controlled access to one stored document.
 *
 * WHY A ROUTE AND NOT A LINK.
 *
 * The bucket is private and there is no permanent URL to put in an `href`. A
 * signed one lives sixty seconds, so it cannot be rendered into a page that
 * might sit open on a desk for an hour — it has to be minted at the moment the
 * doctor clicks. This route is that moment.
 *
 * The raw storage path never reaches the browser. Authorisation is not this
 * route's own invention either: `createDocumentUrl` reads the metadata row
 * under the caller's RLS, and Supabase then requires SELECT on the object
 * before it will sign. Two walls, neither of them this handler.
 *
 * `?download=1` sets Content-Disposition through the signed URL. Without it the
 * browser renders the file, which is what a doctor wants for a one-page slip.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireLocationContext();
  } catch {
    // Same answer for "not signed in" and "no active location". Neither may be
    // distinguished by probing, and neither gets a document.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const download = request.nextUrl.searchParams.get("download") === "1";

  const url = await createDocumentUrl(id, { download });

  /**
   * ONE ANSWER for "no such document", "not yours" and "the object is missing".
   * A 404 that only appears for documents that exist is an existence oracle.
   */
  if (!url) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Best-effort, and after the URL is in hand: a failed log must not stop a
  // doctor reading a report (ADR 0007).
  await logDocumentViewAction(id).catch(() => {});

  return NextResponse.redirect(url, {
    status: 302,
    // A signed URL is single-patient and short-lived. Nothing may cache it,
    // and no shared cache may ever hold this redirect.
    headers: { "Cache-Control": "private, no-store" },
  });
}
