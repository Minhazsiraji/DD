import { describe, expect, it } from "vitest";
import {
  activeDays,
  clinicDay,
  deriveSessions,
  engagedMinutes,
  isAcceptableBucket,
  isActiveDoctor,
  lastEngagedAt,
  minuteBucket,
  minutesBySurface,
  type EngagedMinute,
} from "./engagement";
import {
  ENGAGEMENT_SURFACES,
  QUALIFYING_SURFACES,
  classifySurface,
  isEngagementSurface,
  isQualifyingSurface,
} from "./surfaces";

const at = (iso: string, surface: EngagedMinute["surface"] = "CONSULTATION"): EngagedMinute => ({
  minuteBucket: iso,
  surface,
});

describe("surfaces", () => {
  it("is the frozen O1-A vocabulary, exactly", () => {
    expect([...ENGAGEMENT_SURFACES]).toEqual([
      "DASHBOARD", "PATIENTS", "CONSULTATION", "PRESCRIPTION",
      "APPOINTMENTS", "QUEUE", "SETTINGS", "OWNER",
    ]);
  });

  it("classifies every workspace route by an explicit decision", () => {
    expect(classifySurface("/dashboard")).toBe("DASHBOARD");
    expect(classifySurface("/patients")).toBe("PATIENTS");
    expect(classifySurface("/documents")).toBe("PATIENTS");
    expect(classifySurface("/consultation")).toBe("CONSULTATION");
    expect(classifySurface("/prescription")).toBe("PRESCRIPTION");
    expect(classifySurface("/handover")).toBe("PRESCRIPTION");
    expect(classifySurface("/medicines")).toBe("PRESCRIPTION");
    expect(classifySurface("/appointments")).toBe("APPOINTMENTS");
    expect(classifySurface("/followups")).toBe("APPOINTMENTS");
    expect(classifySurface("/queue")).toBe("QUEUE");
    expect(classifySurface("/settings/profile")).toBe("SETTINGS");
    expect(classifySurface("/owner")).toBe("OWNER");
  });

  /** Not guessed into a surface. No request is made for these at all. */
  it("counts nothing for routes that are not practice", () => {
    for (const path of ["/more", "/payments", "/reports", "/assistant", "/dev", "/", "/login", "/mfa", "/unknown"]) {
      expect(classifySurface(path), path).toBeNull();
    }
  });

  it("reads only the first segment, so ids and queries cannot move the answer", () => {
    expect(classifySurface("/patients/3f1c2b7a-1111-4222-8333-444455556666/encounter/x")).toBe("PATIENTS");
    expect(classifySurface("/prescription/abc?draft=1#item")).toBe("PRESCRIPTION");
    expect(classifySurface("/QUEUE")).toBe("QUEUE");
  });

  it("cannot be steered through the prototype chain", () => {
    for (const path of ["/constructor", "/__proto__", "/toString", "/hasOwnProperty"]) {
      expect(classifySurface(path), path).toBeNull();
    }
  });

  it("rejects anything that is not a string", () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(classifySurface(v as unknown as string)).toBeNull();
    }
  });

  it("guards the enum", () => {
    expect(isEngagementSurface("CONSULTATION")).toBe(true);
    expect(isEngagementSurface("consultation")).toBe(false);
    expect(isEngagementSurface("PATIENT_RECORD")).toBe(false);
    expect(isEngagementSurface(undefined)).toBe(false);
  });
});

describe("SETTINGS alone does not make an Active Doctor", () => {
  it("excludes SETTINGS and OWNER from qualifying surfaces", () => {
    expect(QUALIFYING_SURFACES.has("SETTINGS")).toBe(false);
    expect(QUALIFYING_SURFACES.has("OWNER")).toBe(false);
    expect(isQualifyingSurface("SETTINGS")).toBe(false);
    expect(QUALIFYING_SURFACES.size).toBe(6);
  });

  it("a doctor with only settings minutes is not active", () => {
    const minutes = [
      at("2026-09-10T04:00:00.000Z", "SETTINGS"),
      at("2026-09-10T04:01:00.000Z", "SETTINGS"),
      at("2026-09-10T04:02:00.000Z", "SETTINGS"),
    ];
    expect(isActiveDoctor(minutes)).toBe(false);
    expect(engagedMinutes(minutes)).toBe(0);
    expect(activeDays(minutes)).toEqual([]);
    expect(deriveSessions(minutes)).toEqual([]);
    expect(lastEngagedAt(minutes)).toBeNull();
  });

  it("…but those minutes are still visible per surface", () => {
    const minutes = [at("2026-09-10T04:00:00.000Z", "SETTINGS"), at("2026-09-10T04:01:00.000Z", "SETTINGS")];
    expect(minutesBySurface(minutes)).toEqual({ SETTINGS: 2 });
  });

  it("one qualifying minute is enough", () => {
    const minutes = [at("2026-09-10T04:00:00.000Z", "SETTINGS"), at("2026-09-10T04:05:00.000Z", "QUEUE")];
    expect(isActiveDoctor(minutes)).toBe(true);
    expect(engagedMinutes(minutes)).toBe(1);
  });

  it("an empty window is not active", () => {
    expect(isActiveDoctor([])).toBe(false);
  });
});

describe("engaged minutes are distinct minutes, not durations", () => {
  it("a minute touched on two surfaces is one headline minute", () => {
    const minutes = [
      at("2026-09-10T04:00:00.000Z", "CONSULTATION"),
      at("2026-09-10T04:00:00.000Z", "PRESCRIPTION"),
    ];
    expect(engagedMinutes(minutes)).toBe(1);
    expect(minutesBySurface(minutes)).toEqual({ CONSULTATION: 1, PRESCRIPTION: 1 });
  });

  it("duplicate buckets collapse", () => {
    const minutes = [at("2026-09-10T04:00:00.000Z"), at("2026-09-10T04:00:00.000Z"), at("2026-09-10T04:00:00.000Z")];
    expect(engagedMinutes(minutes)).toBe(1);
  });
});

describe("server-stamped minute bucket", () => {
  it("truncates to the minute", () => {
    expect(minuteBucket(new Date("2026-09-10T04:07:59.999Z"))).toBe("2026-09-10T04:07:00.000Z");
    expect(minuteBucket(new Date("2026-09-10T04:07:00.000Z"))).toBe("2026-09-10T04:07:00.000Z");
  });

  it("refuses an invalid clock", () => {
    expect(() => minuteBucket(new Date(Number.NaN))).toThrow();
  });

  it("accepts only past buckets inside the ingest window", () => {
    const now = new Date("2026-09-10T12:00:30.000Z");
    expect(isAcceptableBucket("2026-09-10T12:00:00.000Z", now)).toBe(true);
    expect(isAcceptableBucket("2026-09-10T12:01:00.000Z", now)).toBe(false);
    expect(isAcceptableBucket("2026-09-08T11:00:00.000Z", now)).toBe(false);
    expect(isAcceptableBucket("not a date", now)).toBe(false);
  });
});

describe("clinic day uses the location timezone, not UTC", () => {
  /** 00:30 in Dhaka on the 11th is 18:30 UTC on the 10th. */
  it("files a just-after-midnight Dhaka minute under the Dhaka day", () => {
    const instant = "2026-09-10T18:30:00.000Z";
    expect(clinicDay(instant, "Asia/Dhaka")).toBe("2026-09-11");
    expect(instant.slice(0, 10)).toBe("2026-09-10");
  });

  it("defaults to the clinic zone rather than UTC", () => {
    expect(clinicDay("2026-09-10T18:30:00.000Z")).toBe("2026-09-11");
  });

  it("falls back to the clinic zone for an unrecognised zone", () => {
    expect(clinicDay("2026-09-10T18:30:00.000Z", "Not/AZone")).toBe("2026-09-11");
  });

  it("counts active days per clinic day", () => {
    const minutes = [
      at("2026-09-10T17:00:00.000Z"), // 23:00 Dhaka, 10th
      at("2026-09-10T18:30:00.000Z"), // 00:30 Dhaka, 11th
      at("2026-09-11T03:00:00.000Z"), // 09:00 Dhaka, 11th
    ];
    expect(activeDays(minutes, "Asia/Dhaka")).toEqual(["2026-09-10", "2026-09-11"]);
  });
});

describe("sessions", () => {
  it("splits at a gap of ten minutes or more", () => {
    const minutes = [
      at("2026-09-10T04:00:00.000Z"),
      at("2026-09-10T04:01:00.000Z"),
      at("2026-09-10T04:09:00.000Z"), // 8-minute gap: same session
      at("2026-09-10T05:00:00.000Z"), // 51-minute gap: new session
    ];
    const sessions = deriveSessions(minutes);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      startedAt: "2026-09-10T04:00:00.000Z",
      endedAt: "2026-09-10T04:10:00.000Z",
      engagedMinutes: 3,
    });
    expect(sessions[1]!.engagedMinutes).toBe(1);
  });

  it("treats exactly the threshold as a new session", () => {
    expect(deriveSessions([at("2026-09-10T04:00:00.000Z"), at("2026-09-10T04:10:00.000Z")])).toHaveLength(2);
  });

  it("is order-independent", () => {
    const a = [at("2026-09-10T05:00:00.000Z"), at("2026-09-10T04:00:00.000Z")];
    expect(deriveSessions(a)).toEqual(deriveSessions([...a].reverse()));
  });

  it("builds sessions from qualifying minutes only", () => {
    const minutes = [at("2026-09-10T04:00:00.000Z", "SETTINGS"), at("2026-09-10T04:30:00.000Z", "QUEUE")];
    expect(deriveSessions(minutes)).toHaveLength(1);
  });
});
