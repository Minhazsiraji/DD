import { describe, expect, it } from "vitest";
import { assertLocalP0DatabaseUrl } from "../../scripts/p0-target.mjs";

describe("P0 database target guard", () => {
  it.each([
    "postgres://user:pass@localhost:5432/db",
    "postgres://user:pass@127.0.0.1:5432/db",
    "postgres://user:pass@[::1]:5432/db",
  ])("accepts loopback %s", (url) => expect(assertLocalP0DatabaseUrl(url)).toBe(url));

  it.each([
    "postgres://user:pass@db.supabase.co:5432/postgres",
    "postgres://user:pass@evil.example:5432/postgres",
    "https://user:pass@localhost:5432/postgres",
  ])("rejects unsafe target %s", (url) => expect(() => assertLocalP0DatabaseUrl(url)).toThrow());
});