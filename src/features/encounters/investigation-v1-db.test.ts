import fs from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.INV1_TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "10000000-0000-4000-8000-000000000002";
const U3 = "10000000-0000-4000-8000-000000000003";
const D1 = "20000000-0000-4000-8000-000000000001";
const D2 = "20000000-0000-4000-8000-000000000002";
const L1 = "30000000-0000-4000-8000-000000000001";
const L2 = "30000000-0000-4000-8000-000000000002";
const P1 = "40000000-0000-4000-8000-000000000001";
const P2 = "40000000-0000-4000-8000-000000000002";
const E_SINGLE = "50000000-0000-4000-8000-000000000001";
const E_MULTI = "50000000-0000-4000-8000-000000000002";
const E_LOC2 = "50000000-0000-4000-8000-000000000003";
const E_STALE = "50000000-0000-4000-8000-000000000004";
const E_WRONG_LOC = "50000000-0000-4000-8000-000000000005";
const E_COMPLETED = "50000000-0000-4000-8000-000000000006";
const E_WRONG_DOC = "50000000-0000-4000-8000-000000000007";
const E_STAFF = "50000000-0000-4000-8000-000000000008";
const E_ATOMIC = "50000000-0000-4000-8000-000000000009";
const E_OTHER = "50000000-0000-4000-8000-000000000010";

const O_SINGLE = "60000000-0000-4000-8000-000000000001";
const O_MULTI = "60000000-0000-4000-8000-000000000002";
const O_LOC2 = "60000000-0000-4000-8000-000000000003";
const O_STALE = "60000000-0000-4000-8000-000000000004";
const O_WRONG_LOC = "60000000-0000-4000-8000-000000000005";
const O_COMPLETED = "60000000-0000-4000-8000-000000000006";
const O_WRONG_DOC = "60000000-0000-4000-8000-000000000007";
const O_STAFF = "60000000-0000-4000-8000-000000000008";
const O_ATOMIC = "60000000-0000-4000-8000-000000000009";
const O_OTHER = "60000000-0000-4000-8000-000000000010";

type DbRow = Record<string, unknown>;

function quoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonLiteral(value: unknown): string {
  return `${quoted(JSON.stringify(value))}::jsonb`;
}

describeDb("INV1-BF-01 disposable PostgreSQL authority", () => {
  it("proves atomic confirmation, idempotency, authority and longitudinal isolation", async () => {
    if (!databaseUrl) throw new Error("INV1_TEST_DATABASE_URL missing");
    const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

    const resetActor = async () => {
      await sql.unsafe("reset role");
      await sql.unsafe("select set_config('request.jwt.claims', '', false)");
    };

    const setActor = async (userId: string, aal = "aal2") => {
      await resetActor();
      await sql.unsafe("set role authenticated");
      await sql.unsafe(
        `select set_config('request.jwt.claims', ${quoted(JSON.stringify({ sub: userId, aal }))}, false)`,
      );
    };

    const confirm = async (
      userId: string,
      encounterId: string,
      locationId: string,
      expectedVersion: number,
      operationKey: string,
      rows: Array<{ name: string; note?: string | null }>,
    ): Promise<DbRow[]> => {
      await setActor(userId);
      return (await sql.unsafe(`
        select *
        from public.confirm_encounter_investigations(
          ${quoted(encounterId)}::uuid,
          ${quoted(locationId)}::uuid,
          ${expectedVersion},
          ${quoted(operationKey)}::uuid,
          ${jsonLiteral(rows)}
        )
      `)) as unknown as DbRow[];
    };

    const expectFailure = async (promise: Promise<unknown>, message: RegExp) => {
      try {
        await promise;
        throw new Error("expected database refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(message);
      }
    };

    try {
      await sql.unsafe(`
        drop schema if exists public cascade;
        drop schema if exists auth cascade;
        drop schema if exists extensions cascade;
        create schema public;
        create schema auth;
        create schema extensions;

        do $$ begin
          if not exists (select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
          if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
          if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
        end $$;

        grant usage on schema public, auth, extensions to anon, authenticated, service_role;
        create extension if not exists pgcrypto with schema extensions;

        create function auth.jwt() returns jsonb
        language sql stable
        as $$
          select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        $$;

        create function auth.uid() returns uuid
        language sql stable
        as $$
          select nullif(auth.jwt() ->> 'sub', '')::uuid
        $$;

        create table public.profiles (
          id uuid primary key,
          full_name text not null
        );
        create table public.doctor_profiles (
          id uuid primary key,
          user_id uuid not null unique references public.profiles(id)
        );
        create table public.practice_locations (
          id uuid primary key,
          name text not null
        );
        create table public.practice_location_members (
          user_id uuid not null references public.profiles(id),
          practice_location_id uuid not null references public.practice_locations(id),
          role text not null,
          status text not null,
          primary key(user_id, practice_location_id, role)
        );
        create table public.patients (
          id uuid primary key,
          owner_doctor_id uuid not null references public.doctor_profiles(id),
          deleted_at timestamptz
        );
        create table public.encounters (
          id uuid primary key,
          owner_doctor_id uuid not null references public.doctor_profiles(id),
          patient_id uuid not null references public.patients(id),
          practice_location_id uuid not null references public.practice_locations(id),
          status text not null default 'DRAFT',
          version integer not null default 1,
          started_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table public.encounter_investigations (
          id uuid primary key default gen_random_uuid(),
          encounter_id uuid not null references public.encounters(id),
          name text not null,
          note text,
          position integer not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table public.encounter_events (
          id uuid primary key default gen_random_uuid(),
          encounter_id uuid not null references public.encounters(id),
          event_type text not null,
          detail jsonb not null default '{}'::jsonb,
          actor_id uuid,
          created_at timestamptz not null default clock_timestamp()
        );
        create table public.audit_events (
          id uuid primary key default gen_random_uuid(),
          practice_location_id uuid not null references public.practice_locations(id),
          actor_id uuid,
          action text not null,
          resource_type text not null,
          resource_id uuid,
          meta jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default clock_timestamp()
        );

        create function public.session_is_aal2()
        returns boolean language sql stable set search_path=pg_catalog,public
        as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' $$;

        create function public.current_doctor_id()
        returns uuid language sql stable security definer set search_path=public,pg_temp
        as $$ select d.id from public.doctor_profiles d where d.user_id=auth.uid() limit 1 $$;

        create function public.doctor_practises_at(target_doctor uuid, target_location uuid)
        returns boolean language sql stable security definer set search_path=public,pg_temp
        as $$
          select exists (
            select 1
            from public.doctor_profiles d
            join public.practice_location_members m on m.user_id=d.user_id
            where d.id=target_doctor
              and m.practice_location_id=target_location
              and m.role='DOCTOR'
              and m.status='ACTIVE'
          )
        $$;

        create function public.encounter_for_update(
          target_encounter uuid,
          expected_location uuid,
          expected_version integer
        ) returns public.encounters
        language plpgsql volatile security definer set search_path=public,pg_temp
        as $$
        declare v_enc public.encounters%rowtype;
        begin
          select * into v_enc from public.encounters where id=target_encounter for update;
          if not found
             or v_enc.owner_doctor_id is distinct from public.current_doctor_id()
             or v_enc.practice_location_id is distinct from expected_location then
            raise exception 'encounter not found' using errcode='42501';
          end if;
          if v_enc.status <> 'DRAFT' then
            raise exception 'ENCOUNTER_NOT_DRAFT' using errcode='22023';
          end if;
          if expected_version is not null and v_enc.version <> expected_version then
            raise exception 'ENCOUNTER_VERSION_CONFLICT';
          end if;
          return v_enc;
        end $$;

        create function public.log_encounter_audit(
          p_encounter_id uuid,
          p_practice_location_id uuid,
          p_action text,
          p_meta jsonb
        ) returns void
        language sql volatile security definer set search_path=public,pg_temp
        as $$
          insert into public.audit_events(
            practice_location_id,actor_id,action,resource_type,resource_id,meta
          ) values (
            p_practice_location_id,auth.uid(),p_action,'encounter',p_encounter_id,coalesce(p_meta,'{}'::jsonb)
          )
        $$;

        insert into public.profiles(id,full_name) values
          ('${U1}','Doctor One'),('${U2}','Doctor Two'),('${U3}','Reception User');
        insert into public.doctor_profiles(id,user_id) values ('${D1}','${U1}'),('${D2}','${U2}');
        insert into public.practice_locations(id,name) values ('${L1}','Chamber One'),('${L2}','Hospital Two');
        insert into public.practice_location_members(user_id,practice_location_id,role,status) values
          ('${U1}','${L1}','DOCTOR','ACTIVE'),
          ('${U1}','${L2}','DOCTOR','ACTIVE'),
          ('${U2}','${L1}','DOCTOR','ACTIVE'),
          ('${U3}','${L1}','RECEPTIONIST','ACTIVE');
        insert into public.patients(id,owner_doctor_id) values ('${P1}','${D1}'),('${P2}','${D2}');
        insert into public.encounters(id,owner_doctor_id,patient_id,practice_location_id,status,version) values
          ('${E_SINGLE}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_MULTI}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_LOC2}','${D1}','${P1}','${L2}','DRAFT',1),
          ('${E_STALE}','${D1}','${P1}','${L1}','DRAFT',3),
          ('${E_WRONG_LOC}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_COMPLETED}','${D1}','${P1}','${L1}','COMPLETED',1),
          ('${E_WRONG_DOC}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_STAFF}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_ATOMIC}','${D1}','${P1}','${L1}','DRAFT',1),
          ('${E_OTHER}','${D2}','${P2}','${L1}','DRAFT',1);
      `);

      const migration = await fs.readFile(
        "supabase/policies/0046_investigation_v1_foundation.sql",
        "utf8",
      );
      await sql.unsafe(migration);

      // 1 + 3 + 4: one custom free-text investigation with optional note.
      const single = await confirm(U1, E_SINGLE, L1, 1, O_SINGLE, [
        { name: "Doctor-authored custom test", note: "fasting" },
      ]);
      expect(single).toEqual([
        { result_version: 2, confirmed_count: 1, replayed: false },
      ]);

      await resetActor();
      let saved = (await sql.unsafe(`
        select name,note,position from public.encounter_investigations
        where encounter_id='${E_SINGLE}' order by position
      `)) as unknown as DbRow[];
      expect(saved).toEqual([
        { name: "Doctor-authored custom test", note: "fasting", position: 1 },
      ]);

      // 2 + 13: several rows commit in staged order and reread exactly from DB.
      const multiRows = [
        { name: "CBC", note: "urgent" },
        { name: "Serum creatinine", note: null },
        { name: "Chest X-ray", note: "PA view" },
      ];
      const multi = await confirm(U1, E_MULTI, L1, 1, O_MULTI, multiRows);
      expect(multi).toEqual([{ result_version: 2, confirmed_count: 3, replayed: false }]);

      await resetActor();
      saved = (await sql.unsafe(`
        select name,note,position from public.encounter_investigations
        where encounter_id='${E_MULTI}' order by position
      `)) as unknown as DbRow[];
      expect(saved).toEqual([
        { name: "CBC", note: "urgent", position: 1 },
        { name: "Serum creatinine", note: null, position: 2 },
        { name: "Chest X-ray", note: "PA view", position: 3 },
      ]);

      // 11: same operation + same logical request safely replays without rows/version duplication.
      const replay = await confirm(U1, E_MULTI, L1, 1, O_MULTI, multiRows);
      expect(replay).toEqual([{ result_version: 2, confirmed_count: 3, replayed: true }]);
      await resetActor();
      const replayState = (await sql.unsafe(`
        select
          (select count(*)::int from public.encounter_investigations where encounter_id='${E_MULTI}') as rows,
          (select version from public.encounters where id='${E_MULTI}') as version,
          (select count(*)::int from public.investigation_confirmation_operations where encounter_id='${E_MULTI}') as operations
      `)) as unknown as DbRow[];
      expect(replayState[0]).toEqual({ rows: 3, version: 2, operations: 1 });

      // 12: same key with a different logical request fails closed.
      await expectFailure(
        confirm(U1, E_MULTI, L1, 1, O_MULTI, [{ name: "Different request" }]),
        /INVESTIGATION_OPERATION_KEY_REUSE/,
      );

      // 6: stale expectedVersion is deterministic and does not mutate.
      await expectFailure(
        confirm(U1, E_STALE, L1, 2, O_STALE, [{ name: "ESR" }]),
        /ENCOUNTER_VERSION_CONFLICT/,
      );

      // 8: wrong active location is refused even when this Doctor legitimately works there.
      await expectFailure(
        confirm(U1, E_WRONG_LOC, L2, 1, O_WRONG_LOC, [{ name: "ESR" }]),
        /encounter not found/i,
      );

      // 7: another Doctor at the same location cannot confirm this encounter.
      await expectFailure(
        confirm(U2, E_WRONG_DOC, L1, 1, O_WRONG_DOC, [{ name: "ESR" }]),
        /encounter not found/i,
      );

      // 9: receptionist/staff has no clinical confirmation authority.
      await expectFailure(
        confirm(U3, E_STAFF, L1, 1, O_STAFF, [{ name: "ESR" }]),
        /only a doctor can confirm investigations/i,
      );

      // 10: a completed encounter rejects clinical mutation.
      await expectFailure(
        confirm(U1, E_COMPLETED, L1, 1, O_COMPLETED, [{ name: "ESR" }]),
        /ENCOUNTER_NOT_DRAFT/,
      );

      // 5: force a failure after the first row reaches INSERT; the whole function
      // transaction must roll back rows, version and operation identity.
      await resetActor();
      await sql.unsafe(`
        create function public.inv1_test_fail_second() returns trigger
        language plpgsql as $$
        begin
          if new.name='FAIL_MID_BATCH' then raise exception 'INV1_TEST_FORCED_FAILURE'; end if;
          return new;
        end $$;
        create trigger inv1_test_fail_second
          before insert on public.encounter_investigations
          for each row execute function public.inv1_test_fail_second();
      `);
      await expectFailure(
        confirm(U1, E_ATOMIC, L1, 1, O_ATOMIC, [
          { name: "First reaches insert" },
          { name: "FAIL_MID_BATCH" },
        ]),
        /INV1_TEST_FORCED_FAILURE/,
      );
      await resetActor();
      const atomic = (await sql.unsafe(`
        select
          (select count(*)::int from public.encounter_investigations where encounter_id='${E_ATOMIC}') as rows,
          (select version from public.encounters where id='${E_ATOMIC}') as version,
          (select count(*)::int from public.investigation_confirmation_operations where encounter_id='${E_ATOMIC}') as operations
      `)) as unknown as DbRow[];
      expect(atomic[0]).toEqual({ rows: 0, version: 1, operations: 0 });
      await sql.unsafe("drop trigger inv1_test_fail_second on public.encounter_investigations");
      await sql.unsafe("drop function public.inv1_test_fail_second()");

      // Confirm one persisted order at Doctor One's second location and one for
      // Doctor Two, then prove Recent is longitudinal but never cross-Doctor.
      await confirm(U1, E_LOC2, L2, 1, O_LOC2, [{ name: "CBC" }]);
      await confirm(U2, E_OTHER, L1, 1, O_OTHER, [{ name: "TSH" }]);

      await setActor(U1);
      const recent = (await sql.unsafe(
        "select * from public.recent_encounter_investigations(50)",
      )) as unknown as DbRow[];
      expect(recent.some((row) => row.name === "CBC" && Number(row.usage_count) === 2)).toBe(true);
      expect(recent.some((row) => row.name === "TSH")).toBe(false);

      // 14–17: patient history spans this Doctor's locations and cannot expose
      // another Doctor's patient/repository.
      const history = (await sql.unsafe(
        `select * from public.patient_investigation_history('${P1}'::uuid,200)`,
      )) as unknown as DbRow[];
      expect(history.some((row) => row.practice_location_id === L1)).toBe(true);
      expect(history.some((row) => row.practice_location_id === L2)).toBe(true);
      expect(history.some((row) => row.investigation_name === "TSH")).toBe(false);
      expect(history.every((row) => row.ordering_doctor_id === D1)).toBe(true);
      expect(history.every((row) => typeof row.ordering_doctor_name === "string")).toBe(true);

      await expectFailure(
        (async () => {
          await setActor(U1);
          return sql.unsafe(`select * from public.patient_investigation_history('${P2}'::uuid,100)`);
        })(),
        /patient not found/i,
      );

      // Audit stays operational: IDs/count/version only; clinical wording is in
      // Doctor-only clinical encounter_events, not audit meta.
      await resetActor();
      const audits = (await sql.unsafe(`
        select action,meta from public.audit_events where resource_id='${E_MULTI}'
      `)) as unknown as DbRow[];
      expect(audits).toHaveLength(1);
      expect(audits[0]?.action).toBe("encounter.investigations_confirmed");
      expect(JSON.stringify(audits[0]?.meta)).not.toMatch(/CBC|creatinine|X-ray|urgent|PA view/i);
      const events = (await sql.unsafe(`
        select event_type,detail from public.encounter_events
        where encounter_id='${E_MULTI}' order by created_at
      `)) as unknown as DbRow[];
      expect(events).toHaveLength(3);
      expect(events.every((row) => row.event_type === "INVESTIGATION_ADDED")).toBe(true);
      expect(events.every((row) => JSON.stringify(row.detail).includes(O_MULTI))).toBe(true);

      // New operational table: RLS + FORCE RLS, no direct authenticated CRUD.
      const rls = (await sql.unsafe(`
        select relrowsecurity,relforcerowsecurity
        from pg_class where oid='public.investigation_confirmation_operations'::regclass
      `)) as unknown as DbRow[];
      expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

      await setActor(U1);
      await expectFailure(
        sql.unsafe("select * from public.investigation_confirmation_operations"),
        /permission denied/i,
      );

      // Exact RPC ACL matrix: anon/service_role have no execute; authenticated does.
      await resetActor();
      const acl = (await sql.unsafe(`
        select
          p.proname,
          has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
          has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
          has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_exec,
          exists (
            select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE'
          ) as public_exec,
          p.prosecdef as security_definer,
          p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname in (
            'confirm_encounter_investigations',
            'recent_encounter_investigations',
            'patient_investigation_history'
          )
        order by p.proname
      `)) as unknown as DbRow[];
      expect(acl).toHaveLength(3);
      for (const row of acl) {
        expect(row).toMatchObject({
          anon_exec: false,
          authenticated_exec: true,
          service_role_exec: false,
          public_exec: false,
          security_definer: true,
        });
        expect(row.config).toEqual(["search_path=public, pg_temp"]);
      }
    } finally {
      try {
        await resetActor();
      } catch {
        // Best-effort cleanup only; the whole PostgreSQL service is disposable.
      }
      await sql.end();
    }
  }, 60_000);
});