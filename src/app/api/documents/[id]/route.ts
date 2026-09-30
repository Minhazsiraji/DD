import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createDocumentUrl } from "@/features/documents/queries";
import { logDocumentAccessAction, type DocumentAccessKind } from "@/features/documents/actions";

export const dynamic = "force-dynamic";

/**
 * Controlled, audited release of private clinical-document bytes.
 * The signed URL is minted first, but is never released unless the append-only
 * access audit succeeds. This makes successful view/download/print requests
 * forensically accountable without making storage public.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const mode = request.nextUrl.searchParams.get("action");
  const kind: DocumentAccessKind =
    mode === "download" ? "downloaded" : mode === "print" ? "printed" : "viewed";
  const url = await createDocumentUrl(id, { download: kind === "downloaded" });

  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });

  const audited = await logDocumentAccessAction(id, kind);
  if (!audited) {
    return NextResponse.json({ error: "access audit unavailable" }, { status: 503 });
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "private, no-store" },
  });
}
