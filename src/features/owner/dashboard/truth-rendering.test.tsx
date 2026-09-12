import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CostTable } from "./components/cost-table";
import { MetricTile } from "./components/metric-tile";
import { ParticipationTable } from "./components/participation-table";
import { TimeSavedCard } from "./components/time-saved-card";
import { UsageTable } from "./components/usage-table";
import { INSUFFICIENT_COHORT, NOT_MEASURED, UNAVAILABLE, type Measurement } from "./measurement";

/**
 * The four truth states, proven at the pixel end of the pipeline.
 *
 * The pure tests prove `formatMeasurement` cannot produce a digit for an
 * absent value. These prove the components actually put those words on the
 * page — a tile that formatted correctly and then rendered `{value ?? 0}`
 * would pass the first set and fail here.
 */
const spec = { key: "sessions", label: "Sessions", unit: "SESSIONS" } as const;
const icon = <span />;

/** Class names and data attributes carry digits; the visible text must not. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .split("")
    .join(" ");
}

describe("a tile renders each state in its own words", () => {
  const cases: Array<[Measurement, string]> = [
    [{ state: "not-measured", lane: "F" }, NOT_MEASURED],
    [{ state: "unavailable" }, UNAVAILABLE],
    [{ state: "insufficient-cohort" }, INSUFFICIENT_COHORT],
  ];

  for (const [measurement, word] of cases) {
    it(`renders ${measurement.state} as “${word}” and prints no number`, () => {
      const html = renderToStaticMarkup(<MetricTile spec={spec} measurement={measurement} icon={icon} />);
      expect(html).toContain(word);
      expect(html).toContain(`data-state="${measurement.state}"`);
      // "k=5" names the privacy rule in the footnote; it is not a value.
      expect(visibleText(html).replaceAll("k=5", "")).not.toMatch(/\d/);
    });
  }

  it("renders a measured zero as 0", () => {
    const html = renderToStaticMarkup(
      <MetricTile spec={spec} measurement={{ state: "measured", value: 0 }} icon={icon} />,
    );
    expect(visibleText(html)).toMatch(/\b0\b/);
    expect(html).not.toContain(NOT_MEASURED);
    expect(html).not.toContain(UNAVAILABLE);
  });

  it("never renders two states at once", () => {
    for (const [measurement] of cases) {
      const html = renderToStaticMarkup(<MetricTile spec={spec} measurement={measurement} icon={icon} />);
      const shown = [NOT_MEASURED, UNAVAILABLE, INSUFFICIENT_COHORT].filter((w) => html.includes(w));
      expect(shown).toHaveLength(1);
    }
  });
});

describe("an unavailable participation list is not an empty one", () => {
  it("says the source did not answer, and never “no doctors”", () => {
    const html = renderToStaticMarkup(<ParticipationTable result={{ state: "unavailable" }} cohort="PILOT_A" />);
    expect(html).toContain("Participation list unavailable");
    expect(html).toMatch(/not the same as/i);
    // It carries the boundary statement, and no count of anything.
    expect(html).toMatch(/Never a patient/i);
    expect(visibleText(html)).not.toMatch(/\d/);
  });

  it("renders a withdrawn participation as unavailable rather than as zeroes", () => {
    const html = renderToStaticMarkup(
      <ParticipationTable
        cohort="PILOT_A"
        result={{
          state: "measured",
          participations: [
            {
              participationId: "aaaaaaaa-1111-2222-3333-444444444444",
              lifecycle: "WITHDRAWN",
              enrolledOn: "2026-08-01",
              measurementStatus: "UNAVAILABLE",
              metrics: {
                engagedMinutes: { state: "unavailable" },
                activeDays: { state: "unavailable" },
                sessions: { state: "unavailable" },
                featureTouches: { state: "unavailable" },
              },
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Withdrawn");
    expect(html).toContain(UNAVAILABLE);
    expect(html).not.toMatch(/>0</);
  });
});

describe("usage and cost keep O1-F's dimensions and O1-E's exactness", () => {
  const row = {
    providerId: "openai",
    modelId: "gpt-4o-mini",
    serviceKind: "AI_PROPOSAL",
    unit: "INPUT_TOKENS",
    quantity: { state: "measured", value: 1200 } as Measurement,
    events: { state: "measured", value: 6 } as Measurement,
    costMinor: "0.0300000000",
    currency: "USD",
  };

  it("shows provider and model rather than one merged AI row", () => {
    const html = renderToStaticMarkup(
      <UsageTable
        cohort="PILOT_A"
        result={{ state: "measured", usage: { rows: [row], status: "OK", hasSuppressedBuckets: false } }}
      />,
    );
    expect(html).toContain("openai");
    expect(html).toContain("gpt-4o-mini");
    expect(html).toContain("Input tokens");
    expect(html).toContain("AI proposal");
  });

  it("announces a suppressed bucket instead of dropping it", () => {
    const html = renderToStaticMarkup(
      <UsageTable
        cohort="PILOT_A"
        result={{ state: "measured", usage: { rows: [row], status: "OK", hasSuppressedBuckets: true } }}
      />,
    );
    expect(html).toContain("Insufficient cohort");
    expect(html).toMatch(/fewer than five/i);
  });

  it("prints a positive sub-cent cost as a sub-cent cost", () => {
    const html = renderToStaticMarkup(
      <CostTable
        cohort="PILOT_A"
        result={{ state: "measured", usage: { rows: [row], status: "OK", hasSuppressedBuckets: false } }}
      />,
    );
    expect(html).toContain("&lt;$0.01");
    expect(html).not.toContain("$0.00");
  });

  it("refuses a total when one bucket's cost is unknown", () => {
    const html = renderToStaticMarkup(
      <CostTable
        cohort="PILOT_A"
        result={{
          state: "measured",
          usage: {
            rows: [row, { ...row, modelId: "gpt-4o", costMinor: null }],
            status: "OK",
            hasSuppressedBuckets: false,
          },
        }}
      />,
    );
    expect(html).toContain(NOT_MEASURED);
    // The known row's cost is still shown; only the TOTAL is withheld.
    expect(html).toContain("&lt;$0.01");
  });
});

describe("estimated time saved", () => {
  it("keeps a negative estimate negative", () => {
    const html = renderToStaticMarkup(<TimeSavedCard view={{ state: "estimated", minutes: -14, confidence: "LOW" }} />);
    expect(html).toContain("-14 min");
    expect(html).toContain("Low confidence");
    expect(html).toMatch(/took longer/i);
  });

  it("uses the frozen ladder and never invents a STANDARD tier", () => {
    for (const confidence of ["HIGH", "MEDIUM", "LOW"] as const) {
      const html = renderToStaticMarkup(
        <TimeSavedCard view={{ state: "estimated", minutes: 9, confidence }} />,
      );
      expect(html).not.toMatch(/standard/i);
    }
  });

  it("says what is missing instead of showing zero", () => {
    const html = renderToStaticMarkup(<TimeSavedCard view={{ state: "not-measured", needs: "an approved baseline" }} />);
    expect(html).toContain(NOT_MEASURED);
    expect(html).toMatch(/not\s*“?no time saved/i);
  });
});
