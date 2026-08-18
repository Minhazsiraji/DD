import "server-only";
import { serviceStorage } from "@/lib/supabase/service";
import type { Fetched, SignatureStore, Written } from "./freeze";

/**
 * The freeze port, bound to the real Supabase Storage API.
 *
 * Every file operation goes through the Storage API. Nothing here inserts,
 * updates or deletes a row in `storage.objects` — that schema is metadata, and
 * writing it directly creates an entry with no object behind it, which reads
 * as success and prints as a broken image on a prescription.
 *
 * Kept as a thin adapter with no decisions in it, so the decisions all live in
 * `freeze.ts` where they can be tested without a network.
 */

/** Supabase reports "already there" through the message, not a status code. */
function isDuplicate(message: string): boolean {
  return /duplicate|already exists|resource already exists/i.test(message);
}

function isMissing(message: string): boolean {
  return /not found|does not exist|no such (file|object)|object not found/i.test(message);
}

export function supabaseSignatureStore(): SignatureStore {
  const storage = serviceStorage();

  return {
    async read(bucket, path): Promise<Fetched> {
      const { data, error } = await storage.from(bucket).download(path);

      if (error) {
        const message = error.message ?? String(error);
        return isMissing(message) ? { kind: "missing" } : { kind: "error", message };
      }
      if (!data) return { kind: "missing" };

      // A Blob, so the bytes are read in full before anything is hashed —
      // hashing a stream that ends early would produce a confident wrong answer.
      const bytes = new Uint8Array(await data.arrayBuffer());
      return { kind: "bytes", bytes, contentType: data.type || null };
    },

    async write(bucket, path, bytes, contentType): Promise<Written> {
      /**
       * `upsert: false` is the control, not a preference. The destination is
       * append-only and must stay that way: a second attempt has to be told
       * "already there" so it can VERIFY, rather than quietly replacing a
       * signature a review may already have attested.
       */
      const { error } = await storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: false,
      });

      if (!error) return { kind: "ok" };
      const message = error.message ?? String(error);
      return isDuplicate(message) ? { kind: "exists" } : { kind: "error", message };
    },
  };
}
