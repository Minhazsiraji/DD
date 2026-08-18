/**
 * The signature freeze, against REAL Supabase Storage.
 *
 * Everything else about the freeze is proved by unit tests over a fake store.
 * This script exists for the parts a fake cannot answer: that the Storage API
 * behaves as we believe on upload/download/info, that custom metadata survives
 * a round trip, that `upsert:false` really refuses, and that an ordinary
 * authenticated user still cannot touch the frozen bucket.
 *
 *   node --env-file=.env.local scripts/verify-signature-freeze.mjs
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY. Without it the freeze cannot run at all —
 * `prescription-assets` has no INSERT policy, which is the point.
 *
 * Cleans up after itself with the service role, which is the ONLY thing allowed
 * to remove a frozen object and only ever for fixtures created here.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url || !anonKey || !dbUrl) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and DIRECT_URL are required.");
  process.exit(1);
}
if (!serviceKey) {
  console.error(
    "\nSUPABASE_SERVICE_ROLE_KEY is not set, so the live freeze cannot run.\n\n" +
      "  Add it to .env.local (it is gitignored):\n" +
      "    SUPABASE_SERVICE_ROLE_KEY=<your Supabase service-role key>\n\n" +
      "This is not a fallback we can work around: `prescription-assets` has no\n" +
      "INSERT policy for `authenticated`, deliberately, so only service-role\n" +
      "code can create a frozen signature.\n",
  );
  process.exit(1);
}

const FROZEN_BUCKET = "prescription-assets";
const SOURCE_BUCKET = "doctor-assets";
const FREEZE_MARKER = "doctors-diary/signature-freeze@1";

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });

const failures = [];
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const png = (seed) => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(seed)]));

/** A real user's client — anon key plus a real signed-in session. */
async function asUser(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return client;
}

const uid = crypto.randomUUID();
const rxA = crypto.randomUUID();
const rxB = crypto.randomUUID();
const sourcePath = `${uid}/signature-live.png`;
const destA = `${uid}/${rxA}/signature`;
const destB = `${uid}/${rxB}/signature`;
const created = [];

const SIG_A = png("AAAA-first-signature");
const SIG_B = png("BBBB-replacement-signature");

async function upload(bucket, path, bytes, marker) {
  const { error } = await service.storage.from(bucket).upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
    ...(marker ? { metadata: marker } : {}),
  });
  if (!error) created.push([bucket, path]);
  return error;
}

try {
  console.log("\nSource signature (doctor-assets)");
  {
    const error = await upload(SOURCE_BUCKET, sourcePath, SIG_A);
    check(!error, "a source signature can be uploaded", error?.message ?? "");

    const { data } = await service.storage.from(SOURCE_BUCKET).download(sourcePath);
    const bytes = new Uint8Array(await data.arrayBuffer());
    check(sha256(bytes) === sha256(SIG_A), "…and downloads byte-for-byte", sha256(bytes).slice(0, 12));
  }

  console.log("\nFirst freeze (prescription-assets)");
  let markerA;
  {
    markerA = { frozenBy: FREEZE_MARKER, frozenFor: rxA, sourceSha256: sha256(SIG_A) };
    const error = await upload(FROZEN_BUCKET, destA, SIG_A, markerA);
    check(!error, "the frozen signature is written through the Storage API", error?.message ?? "");

    const { data } = await service.storage.from(FROZEN_BUCKET).download(destA);
    const bytes = new Uint8Array(await data.arrayBuffer());
    check(sha256(bytes) === markerA.sourceSha256, "…and its bytes hash to what was recorded");

    const { data: info, error: infoError } = await service.storage.from(FROZEN_BUCKET).info(destA);
    check(!infoError, "…and its custom metadata can be read back", infoError?.message ?? "");
    const custom = info?.metadata ?? {};
    check(custom.frozenBy === FREEZE_MARKER, "…carrying the server freeze marker", String(custom.frozenBy));
    check(custom.frozenFor === rxA, "…naming the prescription it was frozen for");
    check(
      custom.sourceSha256 === markerA.sourceSha256,
      "…and the hash of the bytes that were frozen",
      String(custom.sourceSha256).slice(0, 12),
    );
  }

  console.log("\nThe destination is append-only");
  {
    const error = await upload(FROZEN_BUCKET, destA, SIG_B, markerA);
    check(!!error, "a second upload to the same path is refused", error?.message ?? "none!");

    const { data } = await service.storage.from(FROZEN_BUCKET).download(destA);
    const bytes = new Uint8Array(await data.arrayBuffer());
    // Asserted from the BYTES, never from the presence of an error.
    check(sha256(bytes) === sha256(SIG_A), "…and the original bytes are untouched");
  }

  console.log("\nA later profile-signature change does not disturb a prepared prescription");
  {
    // The doctor replaces their profile signature.
    const replaced = `${uid}/signature-live-2.png`;
    await upload(SOURCE_BUCKET, replaced, SIG_B);

    const { data } = await service.storage.from(FROZEN_BUCKET).download(destA);
    const bytes = new Uint8Array(await data.arrayBuffer());
    check(sha256(bytes) === sha256(SIG_A), "the already-frozen prescription still carries the OLD signature");

    // …and a NEW prescription freezes the NEW signature.
    const markerB = { frozenBy: FREEZE_MARKER, frozenFor: rxB, sourceSha256: sha256(SIG_B) };
    const error = await upload(FROZEN_BUCKET, destB, SIG_B, markerB);
    check(!error, "a new prescription freezes the new signature", error?.message ?? "");

    const { data: infoB } = await service.storage.from(FROZEN_BUCKET).info(destB);
    check(infoB?.metadata?.sourceSha256 === sha256(SIG_B), "…recorded under its own hash");
  }

  console.log("\nShort-lived retrieval");
  {
    const { data, error } = await service.storage.from(FROZEN_BUCKET).createSignedUrl(destA, 60);
    check(!error && !!data?.signedUrl, "a signed URL can be issued", error?.message ?? "");

    const response = await fetch(data.signedUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    check(sha256(bytes) === sha256(SIG_A), "…and serves the frozen bytes");

    /**
     * Re-issuing must give a working URL for the SAME object — that is the
     * property that matters, because a signed URL expires and a prescription
     * does not.
     *
     * Deliberately NOT asserting that the two URLs differ: Supabase signs with
     * second-resolution timestamps, so two calls within the same second
     * legitimately produce an identical token. An earlier version asserted it
     * and failed on a fast run — a flaky test about a guarantee nobody makes.
     */
    const second = await service.storage.from(FROZEN_BUCKET).createSignedUrl(destA, 60);
    check(!second.error && !!second.data?.signedUrl, "…and can be re-issued", second.error?.message ?? "");

    const again = await fetch(second.data.signedUrl);
    const againBytes = new Uint8Array(await again.arrayBuffer());
    check(
      sha256(againBytes) === sha256(SIG_A),
      "…serving the same frozen bytes, so the clinical identity is unchanged",
    );

    // The URL is a delivery detail. Nothing clinical may remember it.
    const token = new URL(data.signedUrl).searchParams.get("token") ?? "";
    const [leak] = await sql`
      select
        (select count(*) from public.prescriptions
          where signature_asset_path like '%token%' or signature_asset_path like 'http%')::int as rx,
        (select count(*) from public.prescription_events where detail::text like '%token=%')::int as ev,
        (select count(*) from public.audit_events where meta::text like '%token=%')::int as au`;
    check(
      leak.rx === 0 && leak.ev === 0 && leak.au === 0,
      "no signed URL is stored in prescriptions, events or audit",
      `${leak.rx}/${leak.ev}/${leak.au}`,
    );
    check(token.length > 0, "…and the URL really did carry a token to leak", `${token.length} chars`);
  }

  console.log("\nAn ordinary authenticated user, against the real API");
  {
    const [qa] = await sql`select email from auth.users where email = 'qa.doctor@qa.invalid'`;
    if (!qa) {
      console.log("  – skipped: run `npm run qa:create` first to test a real signed-in user");
    } else {
      const user = await asUser("qa.doctor@qa.invalid", "QaFixture12345");

      const write = await user.storage
        .from(FROZEN_BUCKET)
        .upload(`${uid}/${crypto.randomUUID()}/signature`, SIG_B, { upsert: false });
      check(!!write.error, "cannot upload into the frozen bucket", write.error?.message ?? "IT SUCCEEDED");

      const overwrite = await user.storage
        .from(FROZEN_BUCKET)
        .upload(destA, SIG_B, { upsert: true });
      check(!!overwrite.error, "cannot overwrite a frozen signature", overwrite.error?.message ?? "IT SUCCEEDED");

      /**
       * A storage delete blocked by RLS removes nothing and raises nothing —
       * `remove()` returns an empty list with error === null. So this is
       * asserted from the object still being there, never from an error.
       */
      await user.storage.from(FROZEN_BUCKET).remove([destA]);
      const { data: survived } = await service.storage.from(FROZEN_BUCKET).download(destA);
      const bytes = survived ? new Uint8Array(await survived.arrayBuffer()) : null;
      check(
        bytes !== null && sha256(bytes) === sha256(SIG_A),
        "cannot delete a frozen signature — asserted from the object, not an error",
      );
    }
  }
} catch (e) {
  check(false, "live storage verification", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  for (const [bucket, path] of created) {
    await service.storage.from(bucket).remove([path]).catch(() => {});
  }
  const { data: left } = await service.storage.from(FROZEN_BUCKET).list(uid, { limit: 100 });
  check((left ?? []).length === 0, "live fixture cleaned up", `${(left ?? []).length} left`);
  await sql.end();
}

console.log(
  failures.length === 0
    ? "\nAll live storage checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
