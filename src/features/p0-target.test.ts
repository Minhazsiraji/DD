import { describe, expect, it } from "vitest";
import {
  PROTECTED_PROJECT_REFS,
  assertLocalP0DatabaseUrl,
  extractProjectRefs,
  requireLocalP0DatabaseUrl,
} from "../../scripts/p0-target.mjs";

/**
 * The guard is the only thing standing between the P0 lane and a database, so
 * it is tested the way a control is tested: mostly by trying to get past it.
 *
 * Every case here runs with NO network and NO database. Nothing in this file
 * opens a connection, and nothing resolves a hostname.
 */

const PROTECTED = "gzpqrxrevnkgdyktgrud";

describe("P0 target guard — accepts loopback only", () => {
  it.each([
    ["postgres://user:pass@localhost:5432/db", "plain loopback"],
    ["postgres://user:pass@127.0.0.1:5432/db", "IPv4 loopback"],
    ["postgres://user:pass@[::1]:5432/db", "IPv6 loopback"],
    ["postgresql://user:pass@localhost:54322/postgres", "postgresql:// scheme, Supabase CLI port"],
  ])("accepts %s (%s)", (url) => {
    expect(assertLocalP0DatabaseUrl(url)).toBe(url);
  });

  /**
   * `postgres:` is a non-special URL scheme, so WHATWG does NOT lower-case the
   * host — "LOCALHOST" arrives unchanged and the guard has to fold it itself.
   * The URL comes back as written; only the COMPARISON is case-insensitive.
   */
  it("accepts an uppercase host without rewriting it", () => {
    expect(assertLocalP0DatabaseUrl("postgres://u:p@LOCALHOST:5432/db")).toBe(
      "postgres://u:p@LOCALHOST:5432/db",
    );
  });

  /**
   * Expanded IPv6 loopback is the same address as `::1`, so it is accepted —
   * and the returned string is the WHATWG-normalised form, not the input.
   * Asserted explicitly so nobody later "fixes" the round trip by loosening
   * the comparison.
   */
  it("accepts expanded IPv6 loopback and returns the normalised form", () => {
    expect(assertLocalP0DatabaseUrl("postgres://u:p@[0:0:0:0:0:0:0:1]:5432/db")).toBe(
      "postgres://u:p@[::1]:5432/db",
    );
  });

  /** A real password survives the round trip byte-for-byte. */
  it("preserves percent-encoded credentials exactly", () => {
    const url = "postgres://postgres:p%40ss%3Aword@localhost:5432/postgres";
    expect(assertLocalP0DatabaseUrl(url)).toBe(url);
  });
});

describe("P0 target guard — refuses the protected shared project by name", () => {
  it("knows which ref is protected", () => {
    expect(PROTECTED_PROJECT_REFS.has(PROTECTED)).toBe(true);
  });

  /**
   * Both Supabase addressing forms. The pooler form carries the ref in the
   * USERNAME, and that is the form `.env.local` actually uses for Track B —
   * so it is the one most likely to be pasted by mistake, and a host-only
   * check would miss it entirely.
   */
  it.each([
    [`postgres://postgres:pw@db.${PROTECTED}.supabase.co:5432/postgres`, "direct host form"],
    [
      `postgres://postgres.${PROTECTED}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
      "pooler username form",
    ],
    [
      `postgresql://postgres.${PROTECTED}:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`,
      "pooler, transaction port",
    ],
  ])("refuses %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow(/protected shared project/i);
  });

  it("extracts the ref from both addressing forms", () => {
    expect(
      extractProjectRefs(new URL(`postgres://u:p@db.${PROTECTED}.supabase.co:5432/postgres`)),
    ).toContain(PROTECTED);
    expect(
      extractProjectRefs(
        new URL(`postgres://postgres.${PROTECTED}:p@aws-0-x.pooler.supabase.com:5432/postgres`),
      ),
    ).toContain(PROTECTED);
  });

  /**
   * The named refusal must fire on its own merits, not because the host
   * happens to be non-local. Proven by checking the MESSAGE: if this ever
   * starts reporting "non-local hostname", the two refusals have collapsed
   * into one and the redundancy is gone.
   */
  it("reports the protected project, not merely a non-local host", () => {
    expect(() =>
      assertLocalP0DatabaseUrl(`postgres://u:p@db.${PROTECTED}.supabase.co:5432/postgres`),
    ).toThrow(/Track B/);
  });
});

describe("P0 target guard — refuses everything that is not loopback", () => {
  it.each([
    ["postgres://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres", "any Supabase pooler"],
    ["postgres://u:p@db.someotherproject00.supabase.co:5432/postgres", "any Supabase direct host"],
    ["postgres://u:p@evil.example:5432/db", "arbitrary remote"],
    ["postgres://u:p@10.0.0.5:5432/db", "private LAN address"],
    ["postgres://u:p@0.0.0.0:5432/db", "wildcard address"],
    ["postgres://u:p@[::]:5432/db", "IPv6 wildcard"],
    ["postgres://u:p@127.0.0.2:5432/db", "other loopback-range IPv4, deliberately not accepted"],
    ["postgres://u:p@[::ffff:127.0.0.1]:5432/db", "IPv4-mapped IPv6"],
    ["postgres:///var/run/postgresql/db", "empty host / unix socket"],
  ])("refuses %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow();
  });

  /**
   * THE ONE THAT MATTERS MOST.
   *
   * These names resolve to 127.0.0.1 today. They are still refused, because
   * resolution can change between the check and the connection and the name
   * says nothing about who controls the record. The guard performs no DNS
   * lookup at all — that is the property under test.
   */
  it.each([
    ["postgres://u:p@localtest.me:5432/db", "public name that resolves to loopback"],
    ["postgres://u:p@127.0.0.1.nip.io:5432/db", "wildcard DNS encoding a loopback address"],
    ["postgres://u:p@localhost.localdomain:5432/db", "loopback-ish FQDN"],
  ])("refuses %s (%s) without resolving it", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow(/non-local hostname/);
  });

  /** Name-shaped attacks that try to look like an accepted value. */
  it.each([
    ["postgres://u:p@localhost.evil.com:5432/db", "suffix attack"],
    ["postgres://u:p@notlocalhost:5432/db", "prefix attack"],
    ["postgres://u:p@localhost.:5432/db", "trailing-dot FQDN"],
    ["postgres://u:p@xlocalhost:5432/db", "substring attack"],
  ])("refuses %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow(/non-local hostname/);
  });

  /**
   * URL-syntax smuggling. The last `@` delimits userinfo from host, so the
   * real host in each of these is the remote one — WHATWG parsing gets this
   * right and the guard inherits that. Pinned so a hand-rolled parser can
   * never replace `new URL()` without failing here.
   */
  it.each([
    ["postgres://u:p@localhost@evil.example:5432/db", "userinfo @ smuggling"],
    ["postgres://u:p@evil.example#@localhost/db", "fragment smuggling"],
    ["postgres://u:p@evil.example/?host=localhost", "query-parameter smuggling"],
  ])("refuses %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow(/non-local hostname/);
  });

  /**
   * Obfuscated IPv4 spellings for 127.0.0.1. `postgres:` is a non-special
   * scheme, so WHATWG does not canonicalise these into 127.0.0.1 — they stay
   * as written and are refused. Fail-closed, and pinned so a future switch to
   * a normalising parser cannot silently start accepting them.
   */
  it.each([
    ["postgres://u:p@2130706433:5432/db", "decimal"],
    ["postgres://u:p@0x7f.0.0.1:5432/db", "hexadecimal"],
    ["postgres://u:p@0177.0.0.1:5432/db", "octal"],
    ["postgres://u:p@%6cocalhost:5432/db", "percent-encoded host"],
  ])("refuses obfuscated loopback %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow();
  });

  it.each([
    ["https://u:p@localhost:5432/db", "https"],
    ["http://localhost:5432/db", "http"],
    ["mysql://u:p@localhost:3306/db", "mysql"],
    ["file:///etc/passwd", "file"],
    ["postgres+ssh://u:p@localhost/db", "scheme with a transport suffix"],
  ])("refuses non-PostgreSQL protocol %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow();
  });

  it.each([
    ["", "empty string"],
    ["not a url", "unparseable"],
    ["localhost:5432", "no scheme"],
    ["   ", "whitespace"],
  ])("refuses malformed input %s (%s)", (url) => {
    expect(() => assertLocalP0DatabaseUrl(url)).toThrow();
  });

  it.each([undefined, null, 0, false])("refuses missing target %s", (value) => {
    expect(() => assertLocalP0DatabaseUrl(value as unknown as string)).toThrow(
      /DD_V2_LOCAL_DATABASE_URL/,
    );
  });
});

describe("P0 target guard — reads only the dedicated variable", () => {
  /**
   * The generic application variables are Track-B credentials. A P0 command
   * that fell back to one would connect to the shared project while appearing
   * to have done nothing wrong, so they must never be an INPUT.
   */
  it("never falls back to DATABASE_URL, DIRECT_URL or SUPABASE_DB_URL", () => {
    const saved = {
      DD_V2_LOCAL_DATABASE_URL: process.env.DD_V2_LOCAL_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
      SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    };
    try {
      delete process.env.DD_V2_LOCAL_DATABASE_URL;
      const remote = `postgres://postgres.${PROTECTED}:pw@aws-0-x.pooler.supabase.com:5432/postgres`;
      process.env.DATABASE_URL = remote;
      process.env.DIRECT_URL = remote;
      process.env.SUPABASE_DB_URL = remote;

      expect(() => requireLocalP0DatabaseUrl()).toThrow(/DD_V2_LOCAL_DATABASE_URL/);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("reads DD_V2_LOCAL_DATABASE_URL when it is set", () => {
    const saved = process.env.DD_V2_LOCAL_DATABASE_URL;
    try {
      process.env.DD_V2_LOCAL_DATABASE_URL = "postgres://u:p@localhost:5432/db";
      expect(requireLocalP0DatabaseUrl()).toBe("postgres://u:p@localhost:5432/db");
    } finally {
      if (saved === undefined) delete process.env.DD_V2_LOCAL_DATABASE_URL;
      else process.env.DD_V2_LOCAL_DATABASE_URL = saved;
    }
  });
});
