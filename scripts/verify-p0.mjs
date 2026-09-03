import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const root = process.cwd();
const manifestText = await fs.readFile(path.join(root, "db/manifest.toml"), "utf8");
const steps = [];
let step;
for (const line of manifestText.split(/\r?\n/)) {
  if (line === "[[step]]") { step = {}; steps.push(step); continue; }
  const match = line.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
  if (match && step) step[match[1]] = match[2];
}
if (steps.length !== 6) throw new Error("P0 manifest must contain six steps");
if (steps.map((item) => item.kind).join(",") !== "schema,functions,policies,grants,storage,seed") throw new Error("invalid manifest kind order");
for (const item of steps) {
  const body = await fs.readFile(path.join(root, item.file));
  if (crypto.createHash("sha256").update(body).digest("hex") !== item.sha256) throw new Error(`hash mismatch: ${item.file}`);
}

const alphabet = "0123456789ABCDFGHJKMNPQRSTVWXYZ";
const check = (data) => {
  let state = 31;
  for (const symbol of data) state = (((state + alphabet.indexOf(symbol)) % 31) * 2) % 31;
  return alphabet[(31 + 1 - state) % 31];
};
const validate = (value) => {
  const normalized = value.toUpperCase().replace(/^DD[- ]/i, "").replace(/[\s-]/g, "").replaceAll("I", "1").replaceAll("L", "1").replaceAll("O", "0");
  if (normalized.length !== 10 || [...normalized].some((symbol) => !alphabet.includes(symbol))) return false;
  return check(normalized.slice(0, 9)) === normalized[9];
};
for (let index = 0; index < 31; index += 1) {
  const data = alphabet[index].repeat(9);
  const valid = data + check(data);
  const presented = `DD-${valid.slice(0, 5)}-${valid.slice(5)}`;
  if (!validate(presented)) throw new Error("DD-CHK-31 round-trip failed");
  for (let position = 0; position < 10; position += 1) {
    for (const replacement of alphabet) if (replacement !== valid[position] && validate(`DD-${(valid.slice(0, position) + replacement + valid.slice(position + 1)).slice(0, 5)}-${(valid.slice(0, position) + replacement + valid.slice(position + 1)).slice(5)}`)) throw new Error("single substitution undetected");
  }
}
for (let seed = 0; seed < 1000000; seed += 1) {
  let number = seed;
  let data = "";
  for (let index = 0; index < 9; index += 1) { data += alphabet[number % 31]; number = Math.floor(number / 31); }
  const valid = data + check(data);
  if (!validate(`DD-${valid.slice(0, 5)}-${valid.slice(5)}`)) throw new Error("DD-CHK-31 million-case round-trip failed");
}
console.log("P0 static manifest and DD-CHK-31 exhaustive properties: PASS");

if (process.argv[2]) {
  const sql = postgres(process.argv[2], { max: 1 });
  try {
    const tables = await sql`select tablename, rowsecurity, relforcerowsecurity from pg_tables join pg_class on pg_class.relname=tablename where schemaname='public' order by tablename`;
    if (tables.some((item) => !item.rowsecurity || !item.relforcerowsecurity)) throw new Error("public table is not forced RLS");
    const forbidden = await sql`select tablename from pg_tables where schemaname='public' and tablename in ('platform_staff','platform_staff_roles','student_enrollments','medical_student_profiles','clinical_documents','patient_subject_links','personal_health_documents','service_usage_events','medicine_references','plans')`;
    if (forbidden.length) throw new Error(`P1+ table present: ${forbidden[0].tablename}`);
    const audit = await sql`select column_name from information_schema.columns where table_schema='public' and table_name='audit_events'`;
    if (!audit.some((item) => item.column_name === 'action') || !audit.some((item) => item.column_name === 'resource_id')) throw new Error('audit foundation incomplete');
    const appendOnly = await sql`select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname in ('audit_events','health_subject_origins') and not t.tgisinternal and tgname like '%append_only%'`;
    if (appendOnly.length !== 2) throw new Error('append-only audit/origin triggers incomplete');
    const buckets = await sql`select id, public from storage.buckets where id in ('doctor-profile-photos','doctor-signatures','prescription-assets','clinical-documents','personal-health-documents','community-media','verification-evidence')`;
    if (buckets.length !== 7 || buckets.some((item) => item.public)) throw new Error('private storage bucket boundary incomplete');
    const finalizedTrigger = await sql`select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='prescriptions' and t.tgname='prescriptions_finalized_immutable'`;
    const itemTrigger = await sql`select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='prescription_items' and t.tgname='prescription_items_finalized_immutable'`;
    if (!finalizedTrigger.length || !itemTrigger.length) throw new Error('prescription immutability triggers missing');
    const queueKey = await sql`select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relname='queue_token_counters' and pg_get_constraintdef(c.oid) like '%doctor_chamber_id%session_date%'`;
    if (!queueKey.length) throw new Error('queue counter is not chamber/date keyed');
    const definerLeaks = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('public', p.oid, 'EXECUTE')`;
    if (definerLeaks.length) throw new Error(`definer has PUBLIC EXECUTE: ${definerLeaks[0].proname}`);
    const policyText = await sql`select coalesce(qual,'') || coalesce(with_check,'') as body from pg_policies where schemaname='public'`;
    if (policyText.some((item) => /relationship_label|dd_patient_number/i.test(item.body))) throw new Error('relationship label or DD number used as authorization');
    const clinicalForeignKeys = await sql`select conname from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_class parent on parent.oid=c.confrelid where child.relnamespace='public'::regnamespace and child.relname in ('metric_contributions','metric_rollups','metric_source_refs') and parent.relname in ('clinical_patients','encounters','prescriptions','clinical_documents','health_subjects','appointments')`;
    if (clinicalForeignKeys.length) throw new Error('Domain-L clinical foreign key present');
    console.log(`P0 database boundary: PASS (${tables.length} forced-RLS tables)`);
  } finally { await sql.end(); }
}