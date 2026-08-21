import { NextResponse, type NextRequest } from "next/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getMedicineSuggestions } from "@/features/prescriptions/queries";

/**
 * Autocomplete for the medicine name field.
 *
 * WHY THIS IS A ROUTE AND NOT A SERVER ACTION.
 *
 * It was `medicineSuggestionsAction`, and Next.js SERIALISES server actions
 * from one client: a second action does not start until the first has
 * answered. So the lookup that fires 200ms after the doctor stops typing sat
 * in front of the save they pressed next, and the save could not begin until
 * the lookup finished.
 *
 * Measured on production, submit clicked at t=260ms:
 *
 *   t=205ms   suggestions lookup starts
 *   t=2043ms  suggestions lookup ends          (1,838ms)
 *   t=2049ms  add_prescription_item STARTS     — 6ms after, not 1,789ms before
 *   t=4411ms  add_prescription_item ends
 *
 * The save spent 1.8 seconds queued behind an autocomplete. A doctor typing a
 * long name queues several, and the composer shows "Saving…" for all of it —
 * which is what the pilot reported, and why it looked like a PRN bug: PRN is
 * the box you tick immediately after typing the name, so the lookup is always
 * still in flight on that attempt and never on the retry.
 *
 * A GET route runs on its own connection and cannot enter that queue. A
 * convenience read must never be able to delay a clinical write.
 *
 * Authorisation is UNCHANGED and still server-side: `requireLocationContext()`
 * exactly as the action did, and `getMedicineSuggestions` still runs under the
 * caller's own session with RLS applied, so it returns only the caller's own
 * signed wording.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireLocationContext();
  } catch {
    // Same answer for "not signed in" and "no active clinic": neither may be
    // distinguished by probing, and neither gets suggestions.
    return NextResponse.json({ suggestions: [] }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  // The field itself already refuses to look up fewer than two characters; this
  // is the same rule restated where it is actually enforceable.
  if (query.trim().length < 2) return NextResponse.json({ suggestions: [] });

  const suggestions = await getMedicineSuggestions(query);

  return NextResponse.json(
    { suggestions },
    // A doctor's own past wording is theirs alone — never a shared cache.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
