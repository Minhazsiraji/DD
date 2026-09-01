import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The document boundary, asserted against the SOURCE.
 *
 * These are not a substitute for `npm run db:verify:documents`, which executes
 * the policies under two real sessions — a source test cannot prove what
 * Postgres will do. They exist for the failures a runtime suite cannot see: a
 * policy quietly gaining a second branch, the service-role client appearing in
 * this feature, a storage path reaching a browser, `emitAudit` turning up
 * beside a metadata write.
 */

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

const POLICY = source("supabase/policies/0041_patient_documents.sql");

describe("patient_documents RLS", () => {
  it("is enabled AND forced, and anon is revoked", () => {
    expect(POLICY).toContain("alter table public.patient_documents enable row level security");
    expect(POLICY).toContain("force  row level security");
    expect(POLICY).toContain("revoke all on public.patient_documents from anon");
  });

  it("has ONE read policy, keyed on the owning doctor and nothing else", () => {
    expect(POLICY).toContain("using (owner_doctor_id = public.current_doctor_id())");

    /**
     * The 0039 leak in one line: a location-membership branch on a clinical
     * table admits a SECOND DOCTOR at the same hospital. There is no such
     * branch here and there must never be one.
     */
    const policyBlock = POLICY.slice(
      POLICY.indexOf("create policy patient_documents_select"),
      POLICY.indexOf("grant select on public.patient_documents"),
    );
    expect(policyBlock).not.toMatch(/is_active_member|practice_location_members|has_location_role/);
    expect(policyBlock).not.toMatch(/can_access_patient/);
    expect(policyBlock).not.toMatch(/RECEPTIONIST|LOCATION_ADMIN|'DOCTOR'/);
  });

  it("revokes every write verb — Supabase grants them all by default", () => {
    expect(POLICY).toContain("grant select on public.patient_documents to authenticated");
    expect(POLICY).toContain(
      "revoke insert, update, delete on public.patient_documents from authenticated",
    );
    // A write policy would advertise a direct path and let a later GRANT reopen it.
    expect(POLICY).not.toMatch(/create policy patient_documents_(insert|update|delete)/);
  });
});

describe("the storage bucket", () => {
  it("is private, capped, and cannot be flipped public by a re-run", () => {
    expect(POLICY).toContain("'patient-documents', 'patient-documents', false, 10485760");
    expect(POLICY).toContain("public             = false,");
  });

  it("accepts only the three content types the rest of the stack accepts", () => {
    expect(POLICY).toContain("array['application/pdf', 'image/jpeg', 'image/png']");
  });

  it("has SELECT and INSERT policies pinned to auth.uid(), and no UPDATE or DELETE", () => {
    expect(POLICY).toContain("create policy patient_documents_storage_select");
    expect(POLICY).toContain("create policy patient_documents_storage_insert");
    expect(POLICY).not.toMatch(/create policy patient_documents_storage_(update|delete)/);

    const storagePolicies = POLICY.match(/create policy patient_documents_storage_[\s\S]*?\);/g) ?? [];
    expect(storagePolicies).toHaveLength(2);
    for (const p of storagePolicies) {
      expect(p).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    }
  });
});

describe("the write path", () => {
  it("derives the owner instead of accepting it", () => {
    const fn = POLICY.slice(
      POLICY.indexOf("create or replace function public.create_patient_document"),
      POLICY.indexOf("revoke all on function public.create_patient_document"),
    );
    // No owner parameter at all — an unused default is not a control.
    expect(fn).not.toMatch(/p_owner_doctor_id/);
    expect(fn).toContain("select p.owner_doctor_id from public.patients p where p.id = p_patient_id");
    expect(fn).toContain("public.owns_patient(p_patient_id)");
    expect(fn).toContain("public.doctor_practises_at(v_doctor, p_practice_location_id)");
  });

  it("re-derives the storage path rather than trusting it", () => {
    expect(POLICY).toContain("v_parts[1] is distinct from v_uid::text");
    expect(POLICY).toContain("v_parts[2] is distinct from p_patient_id::text");
    expect(POLICY).toContain("DOCUMENT_PATH_INVALID");
  });

  it("gives one answer for missing, not-yours and elsewhere", () => {
    // A differently-worded refusal is an existence oracle. A count is a
    // disclosure, and so is a message.
    const refusals = POLICY.match(/raise exception '([^']+)' using errcode = '42501'/g) ?? [];
    const targets = refusals.filter((r) => r.includes("not found"));
    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(POLICY).not.toMatch(/raise exception 'patient not found'/);
    expect(POLICY).not.toMatch(/raise exception 'encounter does not belong/);
  });

  it("never raises 40001 for a business rule", () => {
    /**
     * serialization_failure reads as "transient, retry" the whole way up, and
     * PostgREST duly retries — one refusal becomes a retry storm. Comments are
     * stripped first, because the rule is written down in one of them.
     */
    const code = POLICY.split("\n")
      .filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toContain("40001");
    expect(code).toMatch(/raise exception 'DOCUMENT_ALREADY_ARCHIVED';/);
  });

  it("is SECURITY DEFINER with a pinned search_path everywhere it writes", () => {
    const definers = POLICY.match(/security definer\s*\nset search_path = public, pg_temp/g) ?? [];
    // create, archive, restore, the audit logger and the ownership helper.
    expect(definers.length).toBeGreaterThanOrEqual(5);
  });
});

describe("audit", () => {
  it("writes the audit row inside the same transaction, not through emitAudit", () => {
    expect(POLICY).toContain("perform public.log_document_audit(");
    expect(POLICY).toContain("'document.uploaded'");
    expect(POLICY).toContain("'document.archived'");
    expect(POLICY).toContain("'document.restored'");
  });

  it("carries no clinical content into a table a LOCATION_ADMIN can read", () => {
    const meta = POLICY.match(/jsonb_build_object\([\s\S]*?\)/g) ?? [];
    expect(meta.length).toBeGreaterThan(0);
    for (const block of meta) {
      expect(block).not.toMatch(/v_title|p_title|p_notes|v_notes|p_original_filename|v_name/);
      expect(block).not.toMatch(/p_document_type/);
    }
  });

  it("the metadata write path in TypeScript does not emit audit beside the RPC", () => {
    const actions = source("src/features/documents/actions.ts");
    const upload = actions.slice(
      actions.indexOf("export async function uploadDocumentAction"),
      actions.indexOf("export async function archiveDocumentAction"),
    );
    // ADR 0007: an emitAudit call beside a fail-closed write is a bug.
    expect(upload).not.toContain("emitAudit");
  });
});

describe("the feature keeps its hands off privilege", () => {
  const files = [
    "src/features/documents/actions.ts",
    "src/features/documents/queries.ts",
    "src/app/api/documents/[id]/route.ts",
  ];

  it("never reaches the service-role client", () => {
    for (const file of files) {
      const text = source(file);
      expect(text, file).not.toMatch(/serviceStorage|supabase\/service|SERVICE_ROLE/);
      expect(text, file).not.toMatch(/db\/admin/);
    }
  });

  it("never writes storage.objects rows from application code", () => {
    for (const file of files) {
      expect(source(file), file).not.toMatch(/storage\.objects|from\("objects"\)/);
    }
  });

  it("signs URLs with the caller's own client and keeps the TTL short", () => {
    const queries = source("src/features/documents/queries.ts");
    expect(queries).toContain("createSupabaseServerClient");
    expect(queries).toContain("createSignedUrl(storagePath, DOCUMENT_URL_TTL_SECONDS");
    expect(queries).toMatch(/DOCUMENT_URL_TTL_SECONDS = 60\b/);
  });

  it("never returns a storage path to a caller", () => {
    const queries = source("src/features/documents/queries.ts");

    // `PatientDocumentSummary` is what every reader gets, including client
    // components. A path is not a secret, but handing one to a browser invites
    // code that treats it as an address.
    const summary = source("src/features/documents/types.ts");
    expect(summary).not.toMatch(/storagePath|storage_path/);

    // Not in the shared column list, so no list query can carry it back.
    const columns = queries.slice(queries.indexOf("const COLUMNS ="), queries.indexOf("/* eslint"));
    expect(columns).not.toContain("storage_path");

    // It exists only inside the signing function, which returns a URL.
    const signing = queries.slice(queries.indexOf("export async function createDocumentUrl"));
    expect((queries.match(/storage_path/g) ?? []).length).toBe(
      (signing.match(/storage_path/g) ?? []).length,
    );
  });

  it("answers 404 identically for missing and unauthorised documents", () => {
    const route = source("src/app/api/documents/[id]/route.ts");
    expect((route.match(/status: 404/g) ?? []).length).toBe(1);
    expect(route).toContain("private, no-store");
  });
});

describe("the removal contract", () => {
  it("archives, and nothing in the feature deletes a document row", () => {
    const actions = source("src/features/documents/actions.ts");
    expect(actions).toContain("archive_patient_document");
    expect(actions).toContain("restore_patient_document");
    expect(actions).not.toMatch(/\.delete\(\)/);
    expect(POLICY).not.toMatch(/delete from public\.patient_documents/);
  });

  it("requires a reason, and confirms the one storage delete it does attempt", () => {
    expect(POLICY).toContain("DOCUMENT_REASON_REQUIRED");
    const actions = source("src/features/documents/actions.ts");
    // A Supabase delete blocked by RLS removes nothing and raises nothing.
    expect(actions).toContain("(removed ?? []).length === 0");
    expect(actions).toContain("ORPHANED OBJECT");
  });
});
