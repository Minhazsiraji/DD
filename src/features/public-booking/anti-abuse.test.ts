import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("P-S2 public booking anti-abuse boundary", () => {
  let action = "";
  let service = "";
  let sql = "";

  beforeAll(async () => {
    [action, service, sql] = await Promise.all([
      readFile(path.resolve("src/features/public-booking/actions.ts"), "utf8"),
      readFile(path.resolve("src/features/public-booking/service.ts"), "utf8"),
      readFile(path.resolve("supabase/policies/0052_public_booking_anti_abuse.sql"), "utf8"),
    ]);
  });

  it("throttles before the privileged booking write", () => {
    expect(action.indexOf("consumePublicBookingRateLimit")).toBeLessThan(
      action.indexOf("createPublicBookingPrivileged"),
    );
    expect(action).toContain('get("x-forwarded-for")');
  });

  it("keys the limiter from server-observed source identity, not patient fields", () => {
    expect(service).toContain('createHmac("sha256", serviceRoleKey())');
    expect(service).toContain("dd-public-booking:${sourceIp}");
    expect(service).not.toMatch(/patientName|phone/);
  });

  it("fails closed when source identity or the limiter is unavailable", () => {
    expect(action).toMatch(/!sourceIp\s*\|\|\s*!\(await consumePublicBookingRateLimit\(sourceIp\)\)/);
    expect(service).toContain("if (error || typeof data !== \"boolean\")");
    expect(service).toContain("return false;");
  });

  it("uses a durable five-attempt ten-minute source bucket", () => {
    expect(sql).toContain("floor(extract(epoch from clock_timestamp()) / 600) * 600");
    expect(sql).toContain("where rl.request_count < 5");
    expect(sql).toContain("request_count between 1 and 5");
  });

  it("prevents callers from bypassing the limiter through inherited PUBLIC grants", () => {
    expect(sql).toMatch(/revoke execute on function public\.create_public_booking[\s\S]*from public, anon, authenticated, service_role;/);
    expect(sql).toMatch(/grant execute on function public\.create_public_booking[\s\S]*to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.consume_public_booking_rate_limit\(text\) from public, anon, authenticated, service_role;/);
  });

  it("stores only a keyed digest and counters in the limiter table", () => {
    expect(sql).not.toMatch(/patient_name|phone|reason|diagnos|clinical/i);
    expect(sql).toContain("source_key text not null");
  });

  it("keeps public failures collapsed to the existing unavailable response", () => {
    const serverFailureCodes = [...action.matchAll(/\?error=([a-z-]+)/g)].map((m) => m[1]);
    expect([...new Set(serverFailureCodes)].sort()).toEqual(["check-details", "unavailable"]);
  });
});
