import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngagedMinute } from "./engagement";
import { engagementBodySchema, ingestEngagement, type IngestDeps } from "./ingest";
import {
  engagementPipelineWired,
  getEngagementPorts,
  unwiredActivitySink,
  unwiredMinuteStore,
  unwiredTimeSavedInputsPort,
  type ActivityContribution,
  type ActivitySink,
  type EngagementMinuteStore,
} from "./ports";
import { buildEngagementPayload } from "./surfaces";

/**
 * TELEMETRY PRIVACY PROOF.
 *
 * Behavioural where the property can be exercised, static where the property
 * is about what the code must never contain. Every case runs with no network
 * and no database.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
/** Code with comments stripped — the prose names things the code must not do. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DOCTOR = "11111111-2222-4333-8444-555555555555";
const PATIENT_UUID = "3f1c2b7a-1111-4222-8333-444455556666";

function fakePipeline() {
  const stored: Array<{ doctorId: string; periodDay: string; minute: EngagedMinute }> = [];
  const ingested: ActivityContribution[][] = [];
  const minuteStore: EngagementMinuteStore = {
    wired: true,
    async record(doctorId, periodDay, minute) {
      stored.push({ doctorId, periodDay, minute });
      return "RECORDED";
    },
    async snapshot(doctorId, periodDay) {
      return stored.filter((s) => s.doctorId === doctorId && s.periodDay === periodDay).map((s) => s.minute);
    },
  };
  const activitySink: ActivitySink = {
    wired: true,
    async ingest(rows) {
      ingested.push([...rows]);
      return { status: "RECORDED", accepted: rows.length };
    },
  };
  return { minuteStore, activitySink, stored, ingested };
}

const deps = (over: Partial<IngestDeps> = {}): IngestDeps => {
  const p = fakePipeline();
  return {
    now: () => new Date("2026-09-10T04:07:31.000Z"),
    resolveDoctorId: async () => DOCTOR,
    resolveTimeZone: async () => "Asia/Dhaka",
    minuteStore: p.minuteStore,
    activitySink: p.activitySink,
    ...over,
  };
};

describe("the browser sends one enum value and nothing else", () => {
  const hostile = [
    `/patients/${PATIENT_UUID}`,
    `/consultation/${PATIENT_UUID}/encounter/${PATIENT_UUID}`,
    `/prescription/${PATIENT_UUID}?draft=1&patient=${PATIENT_UUID}#item-3`,
    `/queue?q=Rahim%20Hossain&phone=01700000000`,
    `/patients/${PATIENT_UUID}/documents/lab-report.pdf`,
  ];

  it.each(hostile)("builds only { surface } from %s", (p) => {
    const payload = buildEngagementPayload(p);
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!)).toEqual(["surface"]);
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(PATIENT_UUID);
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(wire).not.toMatch(/Rahim|0170|draft|lab-report|\//);
  });

  it("builds nothing at all for routes that are not practice", () => {
    for (const p of ["/more", "/reports", "/login", "/", "/mfa"]) {
      expect(buildEngagementPayload(p), p).toBeNull();
    }
  });
});

describe("the server accepts exactly one key", () => {
  it("accepts { surface }", () => {
    expect(engagementBodySchema.safeParse({ surface: "QUEUE" }).success).toBe(true);
  });

  it.each([
    ["url", "https://dd.example/patients/x"],
    ["path", `/patients/${PATIENT_UUID}`],
    ["patientId", PATIENT_UUID],
    ["encounterId", PATIENT_UUID],
    ["prescriptionId", PATIENT_UUID],
    ["minuteBucket", "2026-09-10T04:00:00.000Z"],
    ["periodDay", "2026-09-10"],
    ["timestamp", 1_788_000_000_000],
    ["value", 99],
    ["sourceVersion", 99],
    ["key", "a"],
    ["ip", "10.0.0.1"],
    ["userAgent", "Mozilla/5.0"],
    ["doctorId", DOCTOR],
  ])("rejects a body carrying %s", (field, value) => {
    expect(engagementBodySchema.safeParse({ surface: "QUEUE", [field]: value }).success).toBe(false);
  });

  it.each([{}, { surface: "queue" }, { surface: "PATIENT_RECORD" }, { surface: 1 }, null, "QUEUE", []])(
    "rejects %j",
    (body) => expect(engagementBodySchema.safeParse(body).success).toBe(false),
  );
});

describe("ingest is server-stamped and day-grain", () => {
  it("derives the clinic day from the server clock, not the client", async () => {
    const p = fakePipeline();
    await ingestEngagement({ surface: "CONSULTATION" }, deps({ ...p }));
    expect(p.stored).toHaveLength(1);
    expect(p.stored[0]!.periodDay).toBe("2026-09-10");
    expect(p.stored[0]!.minute.minuteBucket).toBe("2026-09-10T04:07:00.000Z");
  });

  it("files a just-after-midnight Dhaka minute under the Dhaka day", async () => {
    const p = fakePipeline();
    await ingestEngagement(
      { surface: "QUEUE" },
      deps({ ...p, now: () => new Date("2026-09-10T18:30:10.000Z") }),
    );
    expect(p.stored[0]!.periodDay).toBe("2026-09-11");
    expect(p.ingested[0]!.every((r) => r.periodDay === "2026-09-11")).toBe(true);
  });

  /** O1-F's raw tier has no timestamptz. Nothing sent carries one. */
  it("sends no timestamp to the sink — only a date", async () => {
    const p = fakePipeline();
    await ingestEngagement({ surface: "PATIENTS" }, deps({ ...p }));
    const wire = JSON.stringify(p.ingested[0]);
    expect(wire).toMatch(/"periodDay":"2026-09-10"/);
    expect(wire).not.toMatch(/T\d{2}:\d{2}/);
    expect(wire).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("re-reads the whole day so the total is the day's, not the request's", async () => {
    const p = fakePipeline();
    const d = deps({ ...p, now: () => new Date("2026-09-10T04:07:31.000Z") });
    await ingestEngagement({ surface: "CONSULTATION" }, d);
    await ingestEngagement({ surface: "PRESCRIPTION" }, { ...d, now: () => new Date("2026-09-10T04:09:00.000Z") });
    const last = p.ingested.at(-1)!;
    expect(last.find((r) => r.metricCode === "DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(2);
    expect(last.find((r) => r.metricCode === "DOCTOR_ACTIVE_DAY")!.value).toBe(1);
  });
});

describe("every row sent to O1-F is metadata only", () => {
  const ALLOWED = ["metricCode", "doctorId", "periodDay", "featureCode", "value", "sourceStream", "sourceVersion"].sort();

  it("carries exactly O1-F's argument set and no other field", async () => {
    const p = fakePipeline();
    await ingestEngagement({ surface: "CONSULTATION" }, deps({ ...p }));
    for (const row of p.ingested[0]!) {
      expect(Object.keys(row).sort()).toEqual(ALLOWED);
      // The doctor is the only identifier on a row.
      const uuids = JSON.stringify(row).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
      expect(uuids).toEqual(uuids.filter((u) => u === DOCTOR));
    }
  });

  it("sends no feature touches while O1-F's registry holds only the sentinel", async () => {
    const p = fakePipeline();
    await ingestEngagement({ surface: "CONSULTATION" }, deps({ ...p }));
    expect(p.ingested[0]!.some((r) => r.metricCode === "DOCTOR_FEATURE_TOUCH_DAILY")).toBe(false);
  });
});

describe("an unwired pipeline is honest", () => {
  it("refuses before resolving identity when the sink is missing", async () => {
    const resolveDoctorId = vi.fn(async () => DOCTOR);
    const resolveTimeZone = vi.fn(async () => "Asia/Dhaka");
    const p = fakePipeline();
    const result = await ingestEngagement(
      { surface: "QUEUE" },
      deps({ minuteStore: p.minuteStore, activitySink: unwiredActivitySink, resolveDoctorId, resolveTimeZone }),
    );
    expect(result).toEqual({ status: "UNWIRED" });
    expect(resolveDoctorId).not.toHaveBeenCalled();
    expect(resolveTimeZone).not.toHaveBeenCalled();
    expect(p.stored).toHaveLength(0);
  });

  it("refuses when the minute store is missing, and stores nothing", async () => {
    const p = fakePipeline();
    const result = await ingestEngagement(
      { surface: "QUEUE" },
      deps({ minuteStore: unwiredMinuteStore, activitySink: p.activitySink }),
    );
    expect(result).toEqual({ status: "UNWIRED" });
    expect(p.ingested).toHaveLength(0);
  });

  it("ships every port unwired, so the pipeline is off by default", () => {
    expect(unwiredMinuteStore.wired).toBe(false);
    expect(unwiredActivitySink.wired).toBe(false);
    expect(unwiredTimeSavedInputsPort.wired).toBe(false);
    expect(engagementPipelineWired()).toBe(false);
  });

  it("needs BOTH halves before it will produce anything", () => {
    const p = fakePipeline();
    expect(engagementPipelineWired({ minuteStore: p.minuteStore, activitySink: unwiredActivitySink, timeSavedInputs: unwiredTimeSavedInputsPort })).toBe(false);
    expect(engagementPipelineWired({ minuteStore: unwiredMinuteStore, activitySink: p.activitySink, timeSavedInputs: unwiredTimeSavedInputsPort })).toBe(false);
    expect(engagementPipelineWired({ minuteStore: p.minuteStore, activitySink: p.activitySink, timeSavedInputs: unwiredTimeSavedInputsPort })).toBe(true);
  });

  it("rejects an invalid body before anything else", async () => {
    const p = fakePipeline();
    expect(await ingestEngagement({ surface: "QUEUE", url: "/x" }, deps({ ...p }))).toEqual({ status: "INVALID_BODY" });
    expect(p.stored).toHaveLength(0);
    expect(p.ingested).toHaveLength(0);
  });

  it("records nothing for a non-doctor", async () => {
    const p = fakePipeline();
    expect(await ingestEngagement({ surface: "QUEUE" }, deps({ ...p, resolveDoctorId: async () => null }))).toEqual({ status: "NOT_A_DOCTOR" });
    expect(p.stored).toHaveLength(0);
  });

  /**
   * FAIL CLOSED ON OUTCOMES THIS CODE DOES NOT RECOGNISE.
   *
   * A store or sink outcome that is not exactly RECORDED must never be read as
   * success. This is the fail-closed invariant that mutation testing showed was
   * unpinned; it now sits on O1-A's own state decisions rather than on a
   * duplicate of O1-F's consent authority.
   */
  it.each(["FAILED", "UNWIRED", "SOMETHING_NEW", "", null, undefined])(
    "never reports RECORDED when the store answers %j",
    async (answer) => {
      const p = fakePipeline();
      const store: EngagementMinuteStore = {
        wired: true,
        record: async () => answer as "RECORDED",
        snapshot: p.minuteStore.snapshot,
      };
      const result = await ingestEngagement({ surface: "QUEUE" }, deps({ ...p, minuteStore: store }));
      expect(result.status).not.toBe("RECORDED");
    },
  );

  it.each(["FAILED", "UNWIRED", "SOMETHING_NEW", ""])(
    "never reports RECORDED when the sink answers %j",
    async (answer) => {
      const sink: ActivitySink = { wired: true, ingest: async () => ({ status: answer as "RECORDED", accepted: 0 }) };
      const p = fakePipeline();
      const result = await ingestEngagement({ surface: "QUEUE" }, deps({ ...p, activitySink: sink }));
      expect(result.status).not.toBe("RECORDED");
    },
  );

  it("surfaces a snapshot failure rather than sending a partial total", async () => {
    const p = fakePipeline();
    const store: EngagementMinuteStore = { wired: true, record: async () => "RECORDED", snapshot: async () => "FAILED" };
    expect(await ingestEngagement({ surface: "QUEUE" }, deps({ ...p, minuteStore: store }))).toEqual({ status: "FAILED" });
    expect(p.ingested).toHaveLength(0);
  });

  /** The same fail-closed rule on the snapshot: only an array is usable. */
  it.each(["SOMETHING_NEW", "", null, undefined, 0, {}])(
    "sends nothing when the snapshot is %j rather than an array",
    async (answer) => {
      const p = fakePipeline();
      const store: EngagementMinuteStore = {
        wired: true,
        record: async () => "RECORDED",
        snapshot: async () => answer as unknown as readonly EngagedMinute[],
      };
      const result = await ingestEngagement({ surface: "QUEUE" }, deps({ ...p, minuteStore: store }));
      expect(result.status).not.toBe("RECORDED");
      expect(p.ingested).toHaveLength(0);
    },
  );

  /**
   * THE SHIPPED DEFAULT IS OFF.
   *
   * Asserted on the factory, not on the exported constants: wiring happens in
   * `getEngagementPorts()`, so that is where an accidental enable would land.
   */
  it("ships getEngagementPorts() with every port unwired", () => {
    const ports = getEngagementPorts();
    expect(ports.minuteStore.wired).toBe(false);
    expect(ports.activitySink.wired).toBe(false);
    expect(ports.timeSavedInputs.wired).toBe(false);
  });
});

describe("O1-A holds no copy of O1-F's consent authority", () => {
  /**
   * O1-F's fold materialises a named row only when a participation exists AND
   * `pilot_consent_covers_day(...)` is true, and deletes it otherwise. It does
   * not gate on participation status. An app-side re-implementation would be a
   * second authority on semantics O1-F does not have — so there is none.
   */
  it("defines no participation, consent or named-appearance decision", () => {
    const dir = "src/features/engagement";
    for (const f of featureFiles(dir)) {
      const text = code(f);
      for (const banned of ["mayAppearByName", "consentScope", "ParticipationState", "pilot_participation", "PRODUCT_USAGE"]) {
        expect(text.includes(banned), `${f} must not re-implement consent (${banned})`).toBe(false);
      }
    }
  });
});

function featureFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { recursive: true })
    .map((f) => path.posix.join(dir, String(f).split(path.sep).join("/")))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
}

describe("static: what the code must never contain", () => {
  const BEACON = "src/features/engagement/components/engagement-beacon.tsx";
  const ROUTE = "src/app/api/engagement/route.ts";

  it("the beacon has no timer — an idle tab can never produce a request", () => {
    const c = code(BEACON);
    for (const t of ["setInterval", "setTimeout", "requestAnimationFrame", "requestIdleCallback"]) {
      expect(c.includes(t), t).toBe(false);
    }
  });

  it("the beacon listens only to genuine input, never scroll, mousemove or focus", () => {
    const c = code(BEACON);
    expect(c).toContain('["pointerdown", "keydown", "wheel", "touchstart"]');
    for (const t of ['"scroll"', '"mousemove"', '"focus"', '"visibilitychange"', '"popstate"']) {
      expect(c.includes(t), t).toBe(false);
    }
  });

  it("the handler takes no event, so it cannot read a keystroke", () => {
    const c = code(BEACON);
    expect(c).toContain("const onInteract = () =>");
    for (const t of [".key", ".code", ".target", ".value", "clipboardData", ".which", ".charCode"]) {
      expect(c.includes(t), t).toBe(false);
    }
  });

  it("the beacon never reads the full URL, cookies or the device", () => {
    const c = code(BEACON);
    for (const t of ["location.href", "location.search", "location.hash", "window.location", "document.cookie", "navigator.userAgent", "document.referrer", "localStorage", "sessionStorage"]) {
      expect(c.includes(t), t).toBe(false);
    }
  });

  it("the route never reads a network or device fingerprint", () => {
    const c = code(ROUTE);
    for (const t of ["x-forwarded-for", "x-real-ip", "user-agent", "referer", "request.ip", "request.geo", "headers()", ".headers.get", "nextUrl", "request.url", "searchParams"]) {
      expect(c.includes(t), t).toBe(false);
    }
  });

  it("the route logs nothing", () => {
    expect(code(ROUTE)).not.toMatch(/console\./);
  });

  /** `emitAudit` records IP and user agent — it must never sit on this path. */
  it("no engagement code uses the audit emitter", () => {
    for (const f of [ROUTE, ...featureFiles("src/features/engagement")]) {
      expect(code(f).includes("audit/emit"), f).toBe(false);
    }
  });

  it("no engagement code holds a privileged database handle", () => {
    for (const f of [ROUTE, ...featureFiles("src/features/engagement")]) {
      const c = code(f);
      for (const t of ["SERVICE_ROLE", "serviceStorage", "supabase/service", "db/admin"]) {
        expect(c.includes(t), `${f} (${t})`).toBe(false);
      }
    }
  });

  it("the shell renders the beacon only once both halves are wired", () => {
    expect(code("src/app/(app)/layout.tsx")).toContain("engagementPipelineWired() ? <EngagementBeacon /> : null");
  });
});
