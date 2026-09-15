import "server-only";
import { serviceStorage } from "@/lib/supabase/service";
import type { Described, Fetched, SignatureStore, Written } from "./freeze";

/**
 * The privileged Storage adapter. This stays the one reviewed prescription
 * module allowed to import the service-role boundary. Callers get named asset
 * operations, never a Storage client or arbitrary bucket handle.
 */

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

      const bytes = new Uint8Array(await data.arrayBuffer());
      return { kind: "bytes", bytes, contentType: data.type || null };
    },

    async write(bucket, path, bytes, contentType, marker): Promise<Written> {
      const { error } = await storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: false,
        metadata: { ...marker },
      });

      if (!error) return { kind: "ok" };
      const message = error.message ?? String(error);
      return isDuplicate(message) ? { kind: "exists" } : { kind: "error", message };
    },

    async describe(bucket, path): Promise<Described> {
      const { data, error } = await storage.from(bucket).info(path);

      if (error) {
        const message = error.message ?? String(error);
        return isMissing(message) ? { kind: "missing" } : { kind: "error", message };
      }
      if (!data) return { kind: "missing" };

      const custom = (data.metadata ?? {}) as Record<string, unknown>;
      return {
        kind: "found",
        marker: {
          frozenBy: typeof custom.frozenBy === "string" ? custom.frozenBy : undefined,
          frozenFor: typeof custom.frozenFor === "string" ? custom.frozenFor : undefined,
          sourceSha256:
            typeof custom.sourceSha256 === "string" ? custom.sourceSha256 : undefined,
        },
      };
    },
  };
}

const CLINIC_LOGO_BUCKET = "clinic-assets";

/** Store one new immutable current-logo source object. Never overwrites. */
export async function uploadClinicLogoObject(
  path: string,
  file: File,
  contentType: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await serviceStorage().from(CLINIC_LOGO_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

/** Remove only an uncommitted upload when its DB pointer could not be saved. */
export async function removeUnlinkedClinicLogoObject(path: string): Promise<void> {
  await serviceStorage().from(CLINIC_LOGO_BUCKET).remove([path]);
}

/** Sign an already-authorized clinic-logo path for a short-lived render. */
export async function signedClinicLogoObjectUrl(
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await serviceStorage()
    .from(CLINIC_LOGO_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  return error ? null : data?.signedUrl ?? null;
}
