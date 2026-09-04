/**
 * The single entry point for every P0 command that touches a database.
 *
 * It validates `DD_V2_LOCAL_DATABASE_URL` before importing the target script,
 * so a rejected target never reaches a `postgres()` call. The wrapped scripts
 * validate again on their own — the redundancy is deliberate, because either
 * layer must be sufficient on its own.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO.
 *
 * It does not export `DATABASE_URL`, `DIRECT_URL` or `SUPABASE_DB_URL`.
 *
 * The retired Loop-H version exported all three after validation, reasoning
 * that the value was local by then so propagation was safe. It is safe for the
 * value, but it is not safe for the CONTRACT: once those names carry a working
 * connection, any script imported into this process — including a V1 verifier
 * pulled in by a future edit — silently acquires a database, and the reason it
 * connected stops being visible at the call site. P0-native scripts take the
 * target explicitly. Nothing here needs the generic names, so nothing here
 * sets them.
 *
 * If a legacy V1 wrapper ever genuinely requires the compatibility variables,
 * that is a deliberate, reviewable change to this file — not a default.
 *
 * NO GENERIC VARIABLE IS EVER AN INPUT. `requireLocalP0DatabaseUrl` reads
 * `DD_V2_LOCAL_DATABASE_URL` and nothing else, so a populated `DATABASE_URL`
 * pointing at the shared project cannot be picked up by accident.
 */
import { pathToFileURL } from "node:url";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

/**
 * Scripts this runner may execute.
 *
 * An allowlist, not a convention. The retired Loop-H change routed all
 * thirty-six database commands through here — including P1/P2/P4 verifiers for
 * commercial, claims, owner authority and payments — which would have made
 * later-phase features part of the P0 execution contract and simultaneously
 * broken the V1 lane those commands exist to serve. A command that is not P0
 * cannot be run through the P0 runner at all.
 */
const P0_SCRIPTS = new Set([
  "scripts/deploy-fresh.mjs",
  "scripts/verify-p0.mjs",
  "scripts/verify-deployment-determinism.mjs",
  "scripts/verify-credential-integrity.mjs",
  "scripts/verify-custodial-vs-practice-authority.mjs",
  "scripts/verify-definer-grants.mjs",
  "scripts/verify-definer-search-path-trust.mjs",
  "scripts/verify-anon-surface.mjs",
  "scripts/verify-capability-projection.mjs",
  "scripts/verify-public-booking-representability.mjs",
  "scripts/verify-anon-operational-controls.mjs",
  "scripts/verify-audit-no-clinical-payload.mjs",
  "scripts/verify-phone-canonicalization.mjs",
  "scripts/verify-appointments-p0.mjs",
]);

const [script, ...args] = process.argv.slice(2);

if (!script) {
  throw new Error("usage: p0-run.mjs <p0-script> [args]");
}

const normalized = script.replace(/\\/g, "/");
if (!P0_SCRIPTS.has(normalized)) {
  throw new Error(
    `p0-run.mjs refuses ${script}: not a P0 script. ` +
      `Allowed: ${[...P0_SCRIPTS].join(", ")}. ` +
      "Later-phase and V1 commands run in their own lane and must not join the P0 execution contract.",
  );
}

const databaseUrl = requireLocalP0DatabaseUrl();

/**
 * Re-exported so the wrapped script sees the same VALIDATED string, and the
 * appended argv is the explicit hand-off both P0 scripts already expect:
 *
 *   deploy-fresh.mjs   --database-url <url>   -> argv[2]="--database-url", argv[3]=url
 *   verify-p0.mjs      <url>                  -> argv[2]=url
 *   verify-deployment-determinism.mjs <url>   -> argv[2]=url
 *
 * Sprint-1 B2 verifiers consume the same validated target through
 * DD_V2_LOCAL_DATABASE_URL and ignore the appended positional URL.
 */
process.env.DD_V2_LOCAL_DATABASE_URL = databaseUrl;
process.argv = [process.argv[0], script, ...args, databaseUrl];

await import(pathToFileURL(`${process.cwd()}/${script}`).href);
