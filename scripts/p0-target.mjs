/**
 * THE ONLY GATE BETWEEN THE P0 LANE AND A DATABASE.
 *
 * Track A is Codespace-local. Every P0 script that opens a connection must pass
 * its target through here FIRST, and the check must fail closed: anything this
 * module does not positively recognise as a loopback PostgreSQL target is
 * refused before a client is constructed.
 *
 * TWO INDEPENDENT REFUSALS, deliberately redundant:
 *
 *   1. the protected shared project is named and rejected outright;
 *   2. only loopback hosts are accepted at all.
 *
 * (2) already blocks (1) today — a Supabase host is not loopback. (1) exists
 * because a control that depends on one rule being right is one edit away from
 * being no control. If a future change ever relaxes the host rule, the named
 * refusal still stands, and it stands for a reason a reader can see.
 *
 * NO DNS RESOLUTION HAPPENS HERE, ever. A hostname that merely resolves to
 * 127.0.0.1 — `localtest.me`, `127.0.0.1.nip.io`, an attacker-controlled A
 * record — is NOT local for this purpose: resolution can change between the
 * check and the connection, and the name says nothing about who controls it.
 * Only the three literal loopback spellings are accepted.
 */
import net from "node:net";

/**
 * Project refs that must never be a P0 target, whatever else is true.
 *
 * `gzpqrxrevnkgdyktgrud` is the protected Track-B shared Doctor's Diary
 * project. Writing the P0 baseline into it would contaminate live shared
 * development data.
 */
export const PROTECTED_PROJECT_REFS = new Set(["gzpqrxrevnkgdyktgrud"]);

/**
 * Literal loopback spellings. Not a prefix match, not a suffix match, not a
 * regex — set membership on the parsed hostname, so `localhost.evil.com` and
 * `evilhost` cannot pass by resembling one of these.
 *
 * `127.0.0.2 … 127.255.255.254` are also loopback and are NOT accepted. That
 * is deliberate: the Codespace stack binds 127.0.0.1, so widening the range
 * buys nothing and every additional accepted form is another thing to be wrong
 * about.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/**
 * Pull any Supabase project ref out of a URL.
 *
 * Supabase addresses a project two ways, and both must be searched:
 *
 *   direct   postgres://postgres:pw@db.<ref>.supabase.co:5432/postgres
 *   pooler   postgres://postgres.<ref>:pw@aws-0-<region>.pooler.supabase.com:5432/postgres
 *                       ^^^^^^^^^^^^^^ the ref lives in the USERNAME here
 *
 * Checking only the host would miss every pooler URL — which is exactly the
 * form `.env.local` uses for Track B, so it is the form most likely to be
 * pasted by mistake.
 */
export function extractProjectRefs(parsed) {
  const refs = new Set();
  const host = parsed.hostname.toLowerCase();
  const hostMatch = host.match(/^db\.([a-z0-9]{20})\.supabase\.(co|com)$/);
  if (hostMatch) refs.add(hostMatch[1]);
  // Any 20-char label anywhere in a supabase host, for forms not listed above.
  if (/\.supabase\.(co|com)$/.test(host)) {
    for (const label of host.split(".")) {
      if (/^[a-z0-9]{20}$/.test(label)) refs.add(label);
    }
  }
  const user = decodeURIComponent(parsed.username || "").toLowerCase();
  const userMatch = user.match(/^[a-z0-9_]+\.([a-z0-9]{20})$/);
  if (userMatch) refs.add(userMatch[1]);
  return refs;
}

/**
 * Refuse anything that is not a loopback PostgreSQL target.
 *
 * Returns the parsed URL as a string. Note that this is the WHATWG-NORMALISED
 * form, which is not always byte-identical to the input — `[0:0:0:0:0:0:0:1]`
 * comes back as `[::1]`. Percent-encoded credentials are preserved exactly,
 * which is what matters for a real password.
 *
 * Throws on every rejection. Callers must not catch and continue.
 */
export function assertLocalP0DatabaseUrl(value) {
  if (!value) {
    throw new Error("P0 database target missing: set DD_V2_LOCAL_DATABASE_URL");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    // A URL we cannot parse is a URL we cannot judge. Refuse it.
    throw new Error("P0 database target must be a valid URL");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `P0 database target must use postgres:// or postgresql:// (got ${parsed.protocol})`,
    );
  }

  /**
   * REFUSAL 1 — the protected shared project, by name.
   *
   * Checked before the host rule so that the error names the real problem: a
   * "non-local hostname" message would understate what nearly happened.
   */
  for (const ref of extractProjectRefs(parsed)) {
    if (PROTECTED_PROJECT_REFS.has(ref)) {
      throw new Error(
        `P0 database target REFUSED: ${ref} is the protected shared project (Track B). ` +
          "The P0 lane may never connect to it.",
      );
    }
  }

  /**
   * REFUSAL 2 — anything that is not literally loopback.
   *
   * TWO NORMALISATIONS ARE OURS TO DO, and both were verified by test rather
   * than assumed:
   *
   *   brackets  `URL.hostname` KEEPS them on an IPv6 literal — it returns
   *             "[::1]", not "::1". Dropping the strip silently rejected every
   *             IPv6 loopback target.
   *   case      `postgres:` is a non-special scheme, so WHATWG does NOT
   *             lower-case the host. "LOCALHOST" arrives unchanged.
   *
   * No lookup, no resolution, no "does it point at me" test — set membership
   * on the literal value and nothing else.
   */
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `P0 database target rejected: non-local hostname ${parsed.hostname || "(empty)"}. ` +
        "Track A is Codespace-local; only localhost, 127.0.0.1 and ::1 are accepted.",
    );
  }

  /**
   * Belt and braces on the two IP spellings: if the accepted host is an IP
   * literal, it must genuinely parse as one. This cannot currently fail — both
   * IP entries in the set are valid — and it exists so that adding an entry to
   * `LOOPBACK_HOSTS` that only looks like an address does not silently widen
   * the gate.
   */
  if (hostname !== "localhost" && net.isIP(hostname) === 0) {
    throw new Error(`P0 database target rejected: ${hostname} is not a valid IP literal`);
  }

  return parsed.toString();
}

/**
 * The dedicated P0 target variable, and nothing else.
 *
 * `DATABASE_URL`, `DIRECT_URL` and `SUPABASE_DB_URL` are NEVER read as input:
 * those are the application's Track-B variables, and a P0 command that fell
 * back to one of them would connect to the shared project while looking like
 * it had done nothing wrong.
 */
export function requireLocalP0DatabaseUrl(value = process.env.DD_V2_LOCAL_DATABASE_URL) {
  return assertLocalP0DatabaseUrl(value);
}
