import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * THE COMMERCIAL BOUNDARY IS SQL, SO THIS TEST READS SQL.
 *
 * Area K opens an ANONYMOUS WRITE PATH into the appointments aggregate. There is
 * no session behind it, so every guard that would normally be a doctor's
 * identity has to be restated inside a SECURITY DEFINER function — and a DEFINER
 * function does not inherit RLS. If one of these assertions starts failing, the
 * public internet gained a capability, and the failure is the point.
 *
 * These are STATIC proofs: they show the guard is present and load-bearing in
 * the text that will be applied. The behavioural proofs that need a live
 * database — the two concurrency races, cross-doctor patient isolation, and the
 * clinical-immutability digest across cancel/reactivate — live in
 * scripts/verify-commercial.mjs, which runs in one rolled-back transaction.
 */
const POLICY = "supabase/policies/0030_paid_doctor_commercial.sql";

let sql = "";
/** The body of one `create or replace function public.<name>(...) ... $$;` */
const fn: Record<string, string> = {};

function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in ${POLICY}`);
  const end = source.indexOf("\n$$;", start);
  if (end === -1) throw new Error(`function ${name} has no terminator`);
  return source.slice(start, end);
}

beforeAll(async () => {
  sql = await readFile(path.resolve(POLICY), "utf8");
  for (const name of [
    "public_doctor_profile",
    "public_booking_slots",
    "create_public_booking",
    "ensure_doctor_subscription",
    "current_subscription",
    "submit_manual_subscription_payment",
    "cancel_own_subscription",
    "reactivate_own_subscription",
    "doctor_booking_config",
    "save_doctor_booking_settings",
    "add_doctor_booking_closed_date",
    "remove_doctor_booking_closed_date",
  ]) {
    fn[name] = bodyOf(sql, name);
  }
});

/**
 * The settings RPCs are what make Area K reachable at all: `booking_enabled`
 * defaults to false and every table grant is revoked, so without these a doctor
 * could never turn booking on. They are also the first doctor-authored WRITE
 * into the configuration the public path reads, which makes ownership checking
 * the whole game.
 */
describe("only the owning doctor can configure booking", () => {
  const SETTINGS_FNS = [
    "doctor_booking_config",
    "save_doctor_booking_settings",
    "add_doctor_booking_closed_date",
    "remove_doctor_booking_closed_date",
  ];

  it("is never reachable by anon", () => {
    for (const name of SETTINGS_FNS) {
      expect(sql, `${name} not revoked from anon`).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`),
      );
      const grant = sql.match(
        new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*to ([^;]+);`),
      );
      expect(grant, `${name} has no grant`).not.toBeNull();
      expect(grant![1], `${name} is exposed to anon`).not.toContain("anon");
    }
  });

  it("resolves the doctor from the session, never from a parameter", () => {
    for (const name of SETTINGS_FNS) {
      const body = fn[name]!;
      expect(body).toContain("public.current_doctor_id()");
      const params = body.slice(body.indexOf("(") + 1, body.indexOf(")"));
      expect(params.toLowerCase(), `${name} accepts a caller-supplied doctor`).not.toMatch(
        /doctor_profile|user_id/,
      );
    }
  });

  it("re-proves chamber ownership on every write", () => {
    // A chamber id is a caller-supplied uuid. Knowing one must never be enough.
    for (const name of [
      "save_doctor_booking_settings",
      "add_doctor_booking_closed_date",
      "remove_doctor_booking_closed_date",
    ]) {
      expect(fn[name], `${name} does not verify chamber ownership`).toMatch(
        /where dc\.id = p_chamber_id and dc\.doctor_profile_id = v_doctor/,
      );
      expect(fn[name], `${name} does not refuse a foreign chamber`).toContain("CHAMBER_NOT_FOUND");
    }
  });

  it("refuses to enable booking a patient could not actually use", () => {
    const body = fn.save_doctor_booking_settings!;
    expect(body, "no visiting-hours guard").toContain("NO_VISITING_HOURS");
    expect(body, "no inactive-location guard").toContain("LOCATION_INACTIVE");
  });

  it("revalidates every bound rather than trusting the form", () => {
    const body = fn.save_doctor_booking_settings!;
    for (const code of [
      "INVALID_MODE",
      "INVALID_SLOT_MINUTES",
      "INVALID_MAX_PATIENTS",
      "INVALID_WINDOW",
      "INVALID_LEAD",
      "INVALID_FEE",
      "INVALID_CURRENCY",
    ]) {
      expect(body, `missing ${code}`).toContain(code);
    }
  });

  it("touches no clinical table — closing a date cancels nobody", () => {
    for (const name of SETTINGS_FNS) {
      for (const table of ["patients", "encounters", "prescriptions", "appointments"]) {
        expect(fn[name]!.toLowerCase(), `${name} touches ${table}`).not.toContain(`public.${table}`);
      }
    }
  });
});

describe("every SECURITY DEFINER function is sealed", () => {
  it("pins search_path on all of them", () => {
    // A DEFINER function without a pinned search_path can be hijacked by a
    // caller-controlled schema shadowing `public`.
    for (const [name, body] of Object.entries(fn)) {
      expect(body, `${name} is not security definer`).toContain("security definer");
      expect(body, `${name} does not pin search_path`).toContain(
        "set search_path = public, pg_temp",
      );
    }
  });

  it("revokes the default grant before granting execute", () => {
    // Postgres grants EXECUTE to PUBLIC on every new function by default.
    for (const name of Object.keys(fn)) {
      expect(sql, `${name} never revoked from public`).toMatch(
        new RegExp(`revoke all on function public\\.${name}\\(`),
      );
    }
  });

  it("exposes only the three public functions to anon", () => {
    const anonGrants = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\)\s*\n?\s*to ([^;]+);/g)]
      .filter(([, , roles]) => roles!.includes("anon"))
      .map(([, name]) => name!);
    expect(new Set(anonGrants)).toEqual(
      new Set(["public_doctor_profile", "public_booking_slots", "create_public_booking"]),
    );
  });

  it("gives anon no direct table privilege anywhere in this file", () => {
    const tableGrants = [...sql.matchAll(/grant[^;]*?\son\s+(?:table\s+)?public\.\w+[^;]*;/g)].map(
      (m) => m[0],
    );
    expect(tableGrants, `direct table grants found: ${tableGrants.join(" | ")}`).toEqual([]);
  });

  it("revokes the Supabase default table grants on every new table", () => {
    for (const table of [
      "doctor_booking_settings",
      "doctor_booking_closed_dates",
      "subscription_plans",
      "doctor_subscriptions",
      "subscription_payments",
    ]) {
      expect(sql, `${table} keeps its default grants`).toContain(
        `revoke all on public.${table} from anon, authenticated;`,
      );
    }
  });
});

describe("a slug is not authorization", () => {
  it("requires profile_visibility = PUBLIC in every slug-accepting function", () => {
    for (const name of ["public_doctor_profile", "public_booking_slots", "create_public_booking"]) {
      expect(fn[name], `${name} trusts the slug alone`).toMatch(
        /profile_visibility\s*=\s*'PUBLIC'/,
      );
    }
  });

  it("returns null rather than an error for a private or unknown slug", () => {
    // Distinguishing "private" from "does not exist" would enumerate doctors.
    expect(fn.public_doctor_profile).toMatch(/if not found then\s*\n\s*return null;/);
  });
});

describe("the public profile shape is closed", () => {
  const FORBIDDEN = [
    "user_id",
    "signature_url",
    "photo_url",
    "phone",
    "email",
    "patient",
    "encounter",
    "prescription",
    "audit",
    "practice_location_members",
    "location_role",
  ];

  it("emits no forbidden identifier", () => {
    // Check what the function RETURNS, not what it reads. `user_id` legitimately
    // appears as a join predicate (profiles p on p.id = d.user_id) so the
    // doctor's display name can be resolved — but it must never be emitted.
    const body = fn.public_doctor_profile!;
    const emitted = [...body.matchAll(/'(\w+)',\s*([^\n]*)/g)].map(([, , expr]) => expr!.toLowerCase());
    for (const term of FORBIDDEN) {
      const leak = emitted.find((e) => e.includes(term));
      expect(leak, `public profile emits ${term} via: ${leak}`).toBeUndefined();
    }
  });

  it("reads user_id only to join the display name, never to return it", () => {
    const body = fn.public_doctor_profile!;
    const uses = [...body.matchAll(/^.*user_id.*$/gm)].map((m) => m[0]!.trim());
    expect(uses).toEqual(["join public.profiles p on p.id = d.user_id"]);
  });

  it("returns exactly the agreed keys and nothing more", () => {
    const keys = [...fn.public_doctor_profile!.matchAll(/'(\w+)',\s/g)].map((m) => m[1]!);
    const returned = new Set(keys);
    // The chamber sub-object keys are part of the same closed shape.
    expect(returned).toEqual(
      new Set([
        "fullName",
        "qualification",
        "designation",
        "specialization",
        "bmdc",
        "slug",
        "chambers",
        "chamberId",
        "locationId",
        "name",
        "address",
        "district",
        "publicNote",
        "position",
        "bookingEnabled",
        "bookingMode",
        "consultationFee",
        "currency",
        "sessions",
        "weekday",
        "startsAt",
        "endsAt",
      ]),
    );
  });

  it("shows BMDC only when the doctor opted in, and never as verified", () => {
    expect(fn.public_doctor_profile).toMatch(
      /case when v_doctor\.show_bmdc_on_profile\s*\n?\s*then v_doctor\.bmdc_registration_no\s*\n?\s*else null/,
    );
  });

  it("hides chambers whose practice location is inactive", () => {
    expect(fn.public_doctor_profile).toMatch(/pl\.is_active\s*=\s*true/);
  });
});

describe("the booking write revalidates everything the UI showed", () => {
  const body = () => fn.create_public_booking!;

  it("requires booking to be explicitly enabled", () => {
    expect(body()).toMatch(/bs\.booking_enabled\s*=\s*true/);
  });

  it("resolves the chamber from the doctor, not from caller input", () => {
    // The chamber is reached through dc.doctor_profile_id = d.id, so a caller
    // cannot pair one doctor's slug with another doctor's location.
    expect(body()).toMatch(/join public\.doctor_chambers dc on dc\.doctor_profile_id = d\.id/);
    expect(body()).toMatch(/dc\.practice_location_id = p_location_id/);
  });

  it("enforces the booking window, closed dates, lead time and session hours", () => {
    expect(body(), "booking window").toMatch(/p_date > \(now\(\) at time zone v_timezone\)::date \+ v_window/);
    expect(body(), "closed dates").toContain("doctor_booking_closed_dates");
    expect(body(), "lead time").toContain("TOO_SOON");
    expect(body(), "session hours").toContain("doctor_chamber_hours");
  });

  it("computes the instant through the LOCATION timezone, never the server's", () => {
    // `timestamptz::date` uses the session timezone. A 12:30am Dhaka booking
    // must not file under the previous clinic day.
    expect(body()).toContain("v_instant := v_local at time zone v_timezone");
    expect(body(), "timezone must come from practice_locations").toMatch(/pl\.timezone/);
    // session_date is the chamber-local date the caller asked for, not a cast.
    expect(body()).toMatch(/v_instant, p_date,/);
    expect(body(), "no naive now()::date anywhere").not.toMatch(/[^e]now\(\)::date/);
  });

  it("serialises concurrent bookings on the settings row, not only an advisory hash", () => {
    // FOR UPDATE OF bs takes a real row lock on the chamber's single settings
    // row, so every concurrent booking for that chamber is serialised before
    // any capacity count runs. The advisory lock narrows contention further but
    // is NOT what makes the count safe — a hash key that omitted the session
    // would leave TOKEN capacity racy on its own.
    expect(body(), "missing row lock").toMatch(/for update of bs/);
    expect(body(), "missing advisory lock").toContain("pg_advisory_xact_lock");
  });

  it("counts TIME_SLOT by instant and TOKEN by session date", () => {
    expect(body()).toMatch(/a\.scheduled_for = v_instant/);
    expect(body()).toMatch(/a\.session_date = p_date/);
    expect(body()).toContain("v_count >= v_max");
  });

  it("frees capacity taken by cancelled and no-show appointments", () => {
    const excluded = [...body().matchAll(/status not in \('CANCELLED', 'NO_SHOW'\)/g)];
    expect(excluded.length, "every capacity count must exclude terminal rows").toBeGreaterThanOrEqual(3);
  });
});

describe("public booking cannot cross the doctor tenancy boundary", () => {
  const body = () => fn.create_public_booking!;

  it("scopes patient matching to the owning doctor", () => {
    // The same human phoning two doctors is TWO patient records, never merged.
    const lookup = body().slice(body().indexOf("select p.id into v_patient_id"));
    expect(lookup).toMatch(/p\.owner_doctor_id = v_doctor_id/);
    expect(lookup).toMatch(/p\.phone_normalized = v_phone_norm/);
    expect(lookup).toMatch(/p\.deleted_at is null/);
  });

  it("creates the patient under the resolved doctor, with a per-doctor number", () => {
    expect(body()).toMatch(/insert into public\.patients \(/);
    expect(body()).toMatch(/v_patient_id, v_doctor_id,/);
    expect(body()).toContain("patient_number_seq = patient_number_seq + 1");
  });

  it("maintains patient_location_links", () => {
    expect(body()).toContain("insert into public.patient_location_links");
    expect(body()).toContain("on conflict (patient_id, practice_location_id)");
  });

  it("writes booking_source = PUBLIC and a CREATED event", () => {
    expect(body()).toMatch(/'PUBLIC', v_booking_ref/);
    expect(body()).toMatch(/insert into public\.appointment_events/);
    expect(body()).toMatch(/'CREATED',/);
  });

  it("never allocates a queue token at booking time", () => {
    // Tokens are allocated at ARRIVAL so the number reflects arrival order.
    expect(body().toLowerCase()).not.toContain("token_number");
    expect(body().toLowerCase()).not.toContain("appointment_token_counters");
  });
});

describe("the public response tells the booker nothing about the repository", () => {
  it("returns only bookingRef, date, localTime and status", () => {
    const ret = fn.create_public_booking!.slice(
      fn.create_public_booking!.lastIndexOf("return jsonb_build_object"),
    );
    const keys = [...ret.matchAll(/'(\w+)',/g)].map((m) => m[1]!);
    expect(new Set(keys)).toEqual(new Set(["bookingRef", "date", "localTime", "status"]));
  });

  it("never returns a patient id or says whether the patient already existed", () => {
    const ret = fn.create_public_booking!.slice(
      fn.create_public_booking!.lastIndexOf("return jsonb_build_object"),
    );
    expect(ret).not.toContain("v_patient_id");
    expect(ret).not.toContain("patient_number");
    expect(ret.toLowerCase()).not.toMatch(/existing|matched|created/);
  });

  it("bounds every free-text input the public can send", () => {
    const body = fn.create_public_booking!;
    expect(body, "name").toContain("INVALID_PATIENT_NAME");
    expect(body, "phone").toContain("INVALID_PHONE");
    expect(body, "sex").toContain("INVALID_SEX");
    expect(body, "reason").toContain("REASON_TOO_LONG");
    expect(body, "reason must be capped").toMatch(/length\(p_reason\) > 300/);
  });

  it("normalises the phone to digits before matching", () => {
    expect(fn.create_public_booking).toMatch(
      /regexp_replace\(coalesce\(p_phone, ''\), '\[\^0-9\]', '', 'g'\)/,
    );
  });
});

describe("subscription state is scoped to the doctor and cannot reach clinical data", () => {
  const COMMERCIAL_FNS = [
    "ensure_doctor_subscription",
    "current_subscription",
    "submit_manual_subscription_payment",
    "cancel_own_subscription",
    "reactivate_own_subscription",
  ];

  it("resolves the doctor through current_doctor_id()", () => {
    // Directly, or transitively via ensure_doctor_subscription() — which is
    // itself asserted to scope by current_doctor_id(). What must never happen
    // is a function that takes the doctor as a PARAMETER, because a caller
    // could then name someone else.
    for (const name of COMMERCIAL_FNS) {
      const body = fn[name]!;
      const scoped =
        body.includes("current_doctor_id()") ||
        body.includes("public.ensure_doctor_subscription()");
      expect(scoped, `${name} does not scope by doctor`).toBe(true);
    }
    expect(fn.ensure_doctor_subscription, "the root of the chain must be direct").toContain(
      "v_doctor uuid := public.current_doctor_id()",
    );
  });

  it("takes no doctor identifier as a parameter", () => {
    for (const name of COMMERCIAL_FNS) {
      const body = fn[name]!;
      // The parameter list only — the function NAME contains "doctor".
      const params = body.slice(body.indexOf("(") + 1, body.indexOf(")"));
      expect(params.toLowerCase(), `${name} accepts a caller-supplied doctor`).not.toMatch(
        /doctor|profile_id|user_id/,
      );
    }
  });

  it("never names a clinical table", () => {
    const CLINICAL = [
      "patients",
      "encounters",
      "prescriptions",
      "prescription_items",
      "encounter_diagnoses",
      "encounter_investigations",
      "queue_entries",
      "appointments",
    ];
    for (const name of COMMERCIAL_FNS) {
      for (const table of CLINICAL) {
        expect(fn[name]!.toLowerCase(), `${name} touches ${table}`).not.toContain(
          `public.${table}`,
        );
      }
    }
  });

  it("grants execute to authenticated only — never anon", () => {
    for (const name of COMMERCIAL_FNS) {
      const grant = sql.match(
        new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*to ([^;]+);`),
      );
      expect(grant, `${name} has no grant`).not.toBeNull();
      expect(grant![1], `${name} is exposed to anon`).not.toContain("anon");
    }
  });

  it("creates the first subscription as PILOT, exactly once", () => {
    expect(fn.ensure_doctor_subscription).toMatch(/where code = 'PILOT'/);
    expect(fn.ensure_doctor_subscription).toMatch(/values \(v_doctor, v_plan, 'PILOT'\)/);
    // Returns the existing id rather than inserting a second one.
    expect(fn.ensure_doctor_subscription).toMatch(/if v_id is not null then\s*\n\s*return v_id;/);
    expect(sql, "one subscription per doctor").toMatch(/doctor_profile_id uuid not null unique/);
  });
});

describe("a doctor cannot pay themselves into an active subscription", () => {
  it("has no function that sets a payment CONFIRMED or a subscription ACTIVE", () => {
    // Approval is platform-owner authority, which does not exist on main yet.
    const definers = sql.split("create or replace function").slice(1);
    for (const body of definers) {
      expect(body, "a function sets CONFIRMED").not.toMatch(/status\s*=\s*'CONFIRMED'/);
      expect(body, "a function sets ACTIVE").not.toMatch(/status\s*=\s*'ACTIVE'/);
      expect(body, "a function writes confirmed_at").not.toMatch(/confirmed_at\s*=/);
    }
  });

  it("inserts manual payments as PENDING", () => {
    expect(fn.submit_manual_subscription_payment).toMatch(/'MANUAL_BANK', 'PENDING',/);
  });

  it("rejects duplicate references and absurd amounts", () => {
    const body = fn.submit_manual_subscription_payment!;
    expect(body).toContain("DUPLICATE_REFERENCE");
    expect(body).toMatch(/lower\(btrim\(coalesce\(payer_reference, ''\)\)\) = lower\(btrim\(p_reference\)\)/);
    expect(body).toContain("INVALID_AMOUNT");
    expect(body).toMatch(/p_amount <= 0 or p_amount > 10000000/);
    expect(body).toContain("INVALID_REFERENCE");
  });

  it("lets the doctor set only cancel_at_period_end, and clear it again", () => {
    expect(fn.cancel_own_subscription).toMatch(/set cancel_at_period_end = true/);
    expect(fn.cancel_own_subscription, "cancel must not change status").not.toMatch(
      /set[^;]*\bstatus\s*=/,
    );
    expect(fn.reactivate_own_subscription).toMatch(/set cancel_at_period_end = false/);
    expect(fn.reactivate_own_subscription).toMatch(/cancelled_at = null/);
  });

  it("keeps the founding-doctor price configurable rather than hard-coded", () => {
    const seed = sql.slice(sql.indexOf("insert into public.subscription_plans"));
    expect(seed).toMatch(/\('FOUNDING_DOCTOR', 'Founding Doctor', 0,/);
    expect(seed).toContain("priceConfigurable");
  });
});

describe("no clinical table is put at risk by the commercial tables", () => {
  it("never cascades from a subscription towards clinical data", () => {
    const commercial = sql.slice(sql.indexOf("create table if not exists public.subscription_plans"));
    const cascades = [...commercial.matchAll(/references public\.(\w+)\([^)]*\) on delete (\w+)/g)];
    expect(cascades.length).toBeGreaterThan(0);
    for (const [, table, action] of cascades) {
      if (["doctor_profiles", "doctor_subscriptions", "subscription_plans"].includes(table!)) {
        expect(action, `${table} must not cascade`).toBe("restrict");
      }
    }
  });

  it("contains no delete or update against a clinical table", () => {
    expect(sql.toLowerCase()).not.toMatch(/delete from public\.(patients|encounters|prescriptions)/);
    expect(sql.toLowerCase()).not.toMatch(/update public\.(encounters|prescriptions|prescription_items)/);
  });

  it("only ever adds to appointments — never drops or rewrites a column", () => {
    const alters = [...sql.matchAll(/alter table public\.appointments\s*\n\s*(\w+ \w+)/g)].map(
      (m) => m[1]!,
    );
    for (const action of alters) {
      expect(["add column", "drop constraint", "add constraint"]).toContain(action);
    }
    expect(sql).not.toMatch(/alter table public\.appointments\s*\n\s*drop column/);
  });
});
