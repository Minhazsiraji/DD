import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static contract for the P0 runtime harness.
 *
 * These run on Windows with no database and no Supabase CLI. They cannot prove
 * the harness WORKS — only the Codespace can do that — but they pin the
 * properties that must not silently change, including the one command that
 * could destroy Track B.
 */

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

/** Comments name the defects deliberately, so negative checks read the code. */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const DETERMINISM = "scripts/verify-deployment-determinism.mjs";
const VERIFY = "scripts/verify-p0.mjs";
const DEPLOY = "scripts/deploy-fresh.mjs";

describe("determinism harness — local reset only", () => {
  /**
   * THE SINGLE MOST DANGEROUS FLAG IN THIS REPOSITORY.
   *
   * `supabase db reset --linked` resets the LINKED REMOTE project. If Track A
   * were ever linked, that one flag would destroy Track B's database. It must
   * never appear, and neither must `--db-url`, which would let the reset target
   * an arbitrary connection string that the P0 guard never sees.
   */
  it("never emits --linked or --db-url to the Supabase CLI", () => {
    const text = code(DETERMINISM);
    expect(text).not.toContain("--linked");
    expect(text).not.toContain("--db-url");
    expect(text).not.toMatch(/db["'\s,\]]+push/);
  });

  it("resets explicitly against the local stack, without seeding", () => {
    const text = code(DETERMINISM);
    expect(text).toContain('"db", "reset", "--local", "--no-seed"');
  });

  /**
   * `--no-seed` matters for the proof, not just for speed: a row from
   * `supabase/seed.sql` is not covered by a manifest hash, so a seeded
   * substrate makes the dump depend on something unpinned.
   */
  it("explains why the seed is skipped", () => {
    const text = source(DETERMINISM);
    expect(text).toContain("--no-seed");
    // The reason, not just the flag: an unhashed seed row would make the dump
    // depend on something no manifest hash covers.
    expect(text).toMatch(/unhashed/i);
  });

  it("refuses to run when the CLI is linked to a project", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("supabase/.temp/project-ref");
    expect(text).toMatch(/linked to a project/i);
  });

  it("validates the target through the P0 guard before anything else", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("requireLocalP0DatabaseUrl");
    // The guard call must precede the first CLI invocation.
    expect(text.indexOf("requireLocalP0DatabaseUrl")).toBeLessThan(text.indexOf('"db", "reset"'));
  });
});

describe("determinism harness — the CLI is pinned and the pin is enforced", () => {
  const pkg = JSON.parse(source("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  /**
   * A different CLI version can ship a different platform substrate, and the
   * schema dump would then differ for a reason having nothing to do with the
   * manifest — the proof would be measuring the toolchain.
   */
  it("pins supabase as an exact devDependency", () => {
    expect(pkg.devDependencies?.supabase).toBe("2.116.0");
    // A dev tool, never shipped in the application bundle.
    expect(pkg.dependencies?.supabase).toBeUndefined();
  });

  it("accepts no range, tag or wildcard for that pin", () => {
    const pin = pkg.devDependencies?.supabase ?? "";
    for (const loose of ["^", "~", ">", "<", "*", "x", "latest", "next", " ||", "-"]) {
      expect(pin.includes(loose), `pin must not contain "${loose}"`).toBe(false);
    }
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is installed from the lockfile at that exact version", () => {
    const lock = JSON.parse(source("package-lock.json")) as {
      packages: Record<string, { version?: string; dev?: boolean }>;
    };
    expect(lock.packages["node_modules/supabase"]?.version).toBe("2.116.0");
    expect(lock.packages["node_modules/supabase"]?.dev).toBe(true);
  });

  it("requires the detected CLI version to be exactly the pin", () => {
    const text = code(DETERMINISM);
    expect(text).toContain('const REQUIRED_CLI_VERSION = "2.116.0"');
    expect(text).toContain("detectedCliVersion !== REQUIRED_CLI_VERSION");
    expect(text).toMatch(/expected CLI/);
    expect(text).toMatch(/actual CLI/);
  });

  /**
   * ORDER IS THE POINT. A version check after the first reset would have
   * already rebuilt the substrate with the wrong toolchain.
   */
  it("checks the version BEFORE the first reset", () => {
    const text = code(DETERMINISM);
    const check = text.indexOf("detectedCliVersion !== REQUIRED_CLI_VERSION");
    const reset = text.indexOf('"db", "reset"');
    expect(check).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(-1);
    expect(check).toBeLessThan(reset);
  });

  it("does not require or suggest a global CLI install", () => {
    const text = code(DETERMINISM);
    expect(text).not.toMatch(/npm i(nstall)? -g|npm install --global|brew install supabase/);
    expect(text).toContain("node_modules/supabase/dist/supabase.js");
  });
});

describe("determinism harness — the substrate is Supabase, not raw Postgres", () => {
  /**
   * The previous harness built raw databases with CREATE DATABASE. The P0
   * manifest is written against the Supabase platform substrate and references
   * `auth` and `storage`, so it failed with `schema "auth" does not exist`.
   * That was a defect in the harness, not the manifest.
   */
  it("no longer creates raw PostgreSQL databases", () => {
    const text = code(DETERMINISM);
    expect(text.toLowerCase()).not.toContain("create database");
    expect(text.toLowerCase()).not.toContain("drop database");
  });

  it("asserts the platform substrate exists after every reset", () => {
    const text = code(DETERMINISM);
    expect(text).toMatch(/nspname in \('auth', 'storage'\)/);
    expect(text).toMatch(/platform substrate incomplete/i);
  });

  it("asserts P0 application objects are absent before deploying", () => {
    const text = code(DETERMINISM);
    expect(text).toMatch(/substrate is not clean/i);
    expect(text).toContain("P0_TABLES");
  });

  /**
   * `supabase db reset` replays `supabase/migrations` by default. This repo
   * still carries the V1 lane, so without the config key the "fresh" substrate
   * would arrive carrying V1 tables — which is both not-fresh and the likeliest
   * source of unforced tables in `public`.
   */
  it("refuses to run unless V1 migrations are disabled for reset", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("[db.migrations]");
    expect(text).toMatch(/enabled\\s\*=\\s\*false|enabled\s*=\s*false/);
    expect(text).toMatch(/config\.toml is missing/i);
  });
});

describe("determinism harness — the proof itself", () => {
  it("replays twice and requires A == B == golden", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("for (const round of [1, 2])");
    expect(text).toMatch(/dumpA !== dumpB/);
    expect(text).toMatch(/golden !== dumpA/);
    expect(text).toMatch(/NON-DETERMINISTIC/);
  });

  /**
   * Deployment goes through the shipping script as a child process. A harness
   * that deployed by its own copy of the manifest loop would prove that copy
   * deterministic and say nothing about the path that actually ships.
   */
  it("deploys through the real deploy-fresh script, not a reimplementation", () => {
    const text = code(DETERMINISM);
    expect(text).toContain('"scripts/deploy-fresh.mjs", "--database-url"');
    // No second manifest execution loop in this file.
    expect(text).not.toContain("sql.unsafe(body)");
  });

  it("canonicalizes only the PostgreSQL 17 restrict guard tokens", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("\\\\(restrict|unrestrict)");
    // Exactly one normalisation rule, so nothing else can hide behind it.
    expect((text.match(/\.replace\(\/\^\\\\/g) ?? []).length).toBe(1);
  });

  it("keeps manifest order, hash pinning and the no-stray-SQL rule", () => {
    const text = code(DETERMINISM);
    expect(text).toContain("schema,functions,policies,grants,storage,seed");
    expect(text).toMatch(/manifest hash mismatch/);
    expect(text).toMatch(/executable db SQL exists outside the manifest/);
    expect(text).toMatch(/manifest hash pending/);
  });

  it("reports where two dumps diverge, not merely that they do", () => {
    expect(code(DETERMINISM)).toContain("firstDifference");
  });
});

describe("verify-p0 — the forced-RLS check is namespace-correct", () => {
  /**
   * The old query joined `pg_tables` to `pg_class` ON NAME ONLY, with
   * `schemaname='public'` filtering just the pg_tables side. It therefore
   * matched a public table against every same-named relation in every schema —
   * auth, storage, realtime, extensions — and against indexes, sequences and
   * views. A platform relation's `relforcerowsecurity` is false, so the check
   * could fail for a reason that has nothing to do with P0.
   */
  it("no longer joins pg_class on relname", () => {
    const text = code(VERIFY);
    expect(text).not.toContain("pg_class.relname=tablename");
    expect(text).not.toMatch(/join pg_class on pg_class\.relname/);
  });

  it("pins the namespace and restricts to real tables", () => {
    const text = code(VERIFY);
    expect(text).toContain("join pg_namespace n on n.oid = c.relnamespace");
    expect(text).toContain("n.nspname = 'public'");
    expect(text).toContain("c.relkind in ('r', 'p')");
  });

  /** The invariant is unchanged: BOTH flags, on every table. */
  it("still requires both rowsecurity and relforcerowsecurity", () => {
    const text = code(VERIFY);
    expect(text).toContain("!item.rowsecurity || !item.relforcerowsecurity");
  });

  it("names every offending table and both flag values before failing", () => {
    const text = code(VERIFY);
    expect(text).toContain("FORCED-RLS FAILURE");
    expect(text).toMatch(/for \(const item of unforced\)/);
    expect(text).toContain("unforced.map((i) => i.tablename).join(\", \")");
  });

  /** An empty target is a deployment failure, not a vacuous pass. */
  it("fails when the target has no public tables at all", () => {
    expect(code(VERIFY)).toMatch(/the manifest was not deployed to this target/);
  });
});

describe("every database-touching P0 script is guarded", () => {
  it.each([DEPLOY, VERIFY, DETERMINISM])("%s validates its target", (file) => {
    const text = code(file);
    expect(text).toContain("requireLocalP0DatabaseUrl");
    // Never construct a client from an unvalidated string.
    expect(text).not.toMatch(/postgres\(process\.argv\[\d\]/);
    expect(text).not.toMatch(/postgres\(process\.env\./);
  });
});
