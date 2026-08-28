import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.4.1";

const PHOTO_TTL_SECONDS = 90;
const PROFILE_SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const BUCKET = "doctor-profile-photos";

/**
 * Anonymous public-photo broker.
 *
 * The caller may provide ONLY a public profile slug. The storage path is never
 * accepted from the request and never returned in the response. We resolve the
 * doctor with the admin client, re-prove PUBLIC visibility, derive the one
 * allowed portrait path from the doctor's own user id, and sign that derived
 * path for a short window.
 */
export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ photoUrl: null }, { status: 405, headers: noStoreHeaders() });
    }

    let slug = "";
    try {
      const body = (await req.json()) as { slug?: unknown };
      slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    } catch {
      return Response.json({ photoUrl: null }, { status: 400, headers: noStoreHeaders() });
    }

    if (!PROFILE_SLUG.test(slug)) {
      return Response.json({ photoUrl: null }, { status: 404, headers: noStoreHeaders() });
    }

    const { data: doctor, error } = await ctx.supabaseAdmin
      .from("doctor_profiles")
      .select("user_id, professional_photo_path")
      .eq("profile_slug", slug)
      .eq("profile_visibility", "PUBLIC")
      .maybeSingle();

    // A private slug and a nonexistent slug deliberately have the same result.
    if (error || !doctor) {
      return Response.json({ photoUrl: null }, { status: 404, headers: noStoreHeaders() });
    }

    const userId = typeof doctor.user_id === "string" ? doctor.user_id : "";
    const storedPath =
      typeof doctor.professional_photo_path === "string"
        ? doctor.professional_photo_path.trim()
        : "";
    const expectedPath = userId ? `${userId}/photo` : "";

    if (!expectedPath || storedPath !== expectedPath) {
      return Response.json({ photoUrl: null }, { status: 200, headers: noStoreHeaders() });
    }

    const { data: signed, error: signError } = await ctx.supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(expectedPath, PHOTO_TTL_SECONDS);

    const photoUrl = safeProjectHttpsUrl(signed?.signedUrl ?? null);
    if (signError || !photoUrl) {
      return Response.json({ photoUrl: null }, { status: 200, headers: noStoreHeaders() });
    }

    return Response.json({ photoUrl }, { status: 200, headers: noStoreHeaders() });
  }),
};

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function safeProjectHttpsUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const signed = new URL(value);
    const project = new URL(Deno.env.get("SUPABASE_URL") ?? "");
    if (
      signed.protocol !== "https:" ||
      signed.username ||
      signed.password ||
      signed.origin !== project.origin
    ) {
      return null;
    }
    return signed.toString();
  } catch {
    return null;
  }
}
