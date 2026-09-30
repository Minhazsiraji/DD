import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
const sql = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/policies/0056_patient_documents_immutable_audit.sql"),
  "utf8",
);
const route = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/api/documents/[id]/route.ts"),
  "utf8",
);
const filters = fs.readFileSync(
  path.resolve(process.cwd(), "src/features/documents/components/document-filters.tsx"),
  "utf8",
);

describe("Documents V2 immutable/audited boundary", () => {
  it("has no storage update/delete policy and guards immutable metadata", () => {
    expect(sql).toContain("drop policy if exists patient_documents_storage_update");
    expect(sql).toContain("drop policy if exists patient_documents_storage_delete");
    expect(sql).toContain("PATIENT_DOCUMENT_IMMUTABLE");
    expect(sql).toContain("revoke update,delete,truncate on public.patient_documents from authenticated");
  });

  it("allows delegated upload without delegating clinical read to staff", () => {
    expect(sql).toContain("me.role in ('ASSISTANT','RECEPTIONIST')");
    expect(sql).toContain("p.patient_account_id = auth.uid()");
    expect(sql).not.toMatch(/patient_documents_select[\s\S]{0,500}RECEPTIONIST/);
  });

  it("keeps archive history append-only with a mandatory reason", () => {
    expect(sql).toContain("patient_document_events");
    expect(sql).toContain("event_type='ARCHIVED' and reason is not null");
    expect(sql).toContain("insert into public.patient_document_events(document_id,event_type,actor_id,reason)");
  });

  it("distinguishes view/download/print and fails closed before releasing the signed URL", () => {
    expect(sql).toContain("'document.viewed','document.downloaded','document.printed'");
    expect(sql).toContain("p_user_agent");
    expect(sql).toContain("p_ip");
    expect(route).toContain("access audit unavailable");
    expect(route.indexOf("logDocumentAccessAction")).toBeLessThan(route.indexOf("NextResponse.redirect"));
  });

  it("stores a SHA-256 integrity value and never logs title/filename/notes/type", () => {
    expect(sql).toContain("sha256");
    const accessFn = sql.slice(sql.indexOf("log_patient_document_access"), sql.indexOf("guard_patient_document_immutability"));
    expect(accessFn).not.toMatch(/title|filename|notes|document_type/);
  });

  it("keeps desktop filters in one aligned row while preserving mobile/tablet stacking", () => {
    expect(filters).toContain("grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end");
    expect(filters).toContain("<label htmlFor=\"document-type\" className=\"sr-only\">");
    expect(filters).toContain("<label htmlFor=\"document-from\" className=\"sr-only\">");
    expect(filters).toContain("<label htmlFor=\"document-to\" className=\"sr-only\">");
    expect(filters).toContain("<span className=\"sr-only\">Status</span>");
  });
});
