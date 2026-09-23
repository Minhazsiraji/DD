import { describe, expect, it } from "vitest";
import { insertTranscript } from "./dictation";
import { parseM6DLocalCommand, type M6DTarget } from "./m6d-intent-router";
import {
  INITIAL_M6D_VOICE_STATE,
  applyM6DTextEdit,
  m6dVoiceDestinationForIntent,
  m6dVoiceFocusSelector,
  m6dVoiceSection,
  type M6DVoiceDestination,
  type M6DVoiceSession,
} from "./m6d-voice-state";

type Mutation = { field: string; before: string; after: string } | null;
type Harness = {
  destination: M6DVoiceDestination;
  session: M6DVoiceSession;
  notes: Record<M6DTarget, string>;
  diagnosis: { title: string; note: string; certainty: string };
  investigation: string;
  mutation: Mutation;
  consumed: string[];
};

function createHarness(): Harness {
  return {
    destination: INITIAL_M6D_VOICE_STATE.destination,
    session: "listening",
    notes: { chiefComplaints: "", presentIllness: "", pastHistory: "", examination: "", assessment: "", advice: "", nextVisitNote: "" },
    diagnosis: { title: "", note: "", certainty: "PROVISIONAL" },
    investigation: "",
    mutation: null,
    consumed: [],
  };
}

function append(current: string, text: string) {
  return insertTranscript(current, text, current.length).text;
}

function speak(h: Harness, text: string) {
  const intent = parseM6DLocalCommand(text);
  if (intent.type !== "NONE") {
    h.consumed.push(text);
    if (intent.type === "PAUSE") h.session = "paused";
    else if (intent.type === "RESUME") h.session = "listening";
    else if (intent.type === "END") h.session = "idle";
    else if (intent.type === "UNDO") {
      const change = h.mutation;
      if (change && h.destination.kind === "diagnosis" && change.field === `diagnosis.${h.destination.target}`) {
        h.diagnosis[h.destination.target as "title" | "note"] = change.before;
        h.mutation = null;
      }
    } else if (intent.type === "DIAGNOSIS_CERTAINTY") {
      h.destination = { kind: "diagnosis", target: "certainty" };
      h.diagnosis.certainty = intent.certainty;
    } else {
      const destination = m6dVoiceDestinationForIntent(h.destination, intent);
      if (destination) h.destination = destination;
      else if (h.destination.kind === "note") {
        const before = h.notes[h.destination.target];
        const after = applyM6DTextEdit(before, intent);
        if (after !== null) {
          h.notes[h.destination.target] = after;
          h.mutation = { field: `note.${h.destination.target}`, before, after };
        }
      }
    }
    return;
  }
  if (h.session !== "listening") return;
  if (h.destination.kind === "note") {
    const before = h.notes[h.destination.target];
    const after = append(before, text);
    h.notes[h.destination.target] = after;
    h.mutation = { field: `note.${h.destination.target}`, before, after };
  } else if (h.destination.kind === "diagnosis" && h.destination.target !== "certainty") {
    const before = h.diagnosis[h.destination.target];
    const after = append(before, text);
    h.diagnosis[h.destination.target] = after;
    h.mutation = { field: `diagnosis.${h.destination.target}`, before, after };
  } else if (h.destination.kind === "investigation") {
    const before = h.investigation;
    const after = append(before, text);
    h.investigation = after;
    h.mutation = { field: "investigation", before, after };
  }
}

function expectAligned(h: Harness, section: ReturnType<typeof m6dVoiceSection>, selector: string) {
  expect(m6dVoiceSection(h.destination)).toBe(section);
  expect(m6dVoiceFocusSelector(h.destination)).toBe(selector);
}

describe("M6D protected human-like sequential regression", () => {
  it("keeps session, visible target, focus, consumption, and destination aligned", () => {
    const h = createHarness();
    speak(h, "History");
    expectAligned(h, "presentIllness", "#presentIllness");
    speak(h, "Fever for three days");
    expect(h.notes.presentIllness).toBe("Fever for three days");

    speak(h, "Pause");
    speak(h, "must not be written");
    expect(h.notes.presentIllness).toBe("Fever for three days");
    speak(h, "Resume");
    speak(h, "No vomiting");
    expect(h.notes.presentIllness).toBe("Fever for three days No vomiting");

    speak(h, "Diagnosis");
    expectAligned(h, "diagnoses", "[data-m6d-diagnosis-title]");
    speak(h, "Dengue fever");
    expect(h.diagnosis.title).toBe("Dengue fever");
    expect(h.notes.chiefComplaints).toBe("");
    speak(h, "Confirmed");
    expect(h.diagnosis).toMatchObject({ title: "Dengue fever", certainty: "CONFIRMED" });
    speak(h, "Diagnosis note");
    expectAligned(h, "diagnoses", "[data-m6d-diagnosis-note]");
    speak(h, "Review tomorrow");
    speak(h, "Undo");
    expect(h.diagnosis.note).toBe("");

    speak(h, "Investigation orders");
    expectAligned(h, "investigations", "#investigation-search");
    speak(h, "CBC and Lipid profile");
    expect(h.investigation).toBe("CBC and Lipid profile");
    expect(h.notes.chiefComplaints).toBe("");
    speak(h, "Previous");
    expectAligned(h, "diagnoses", "[data-m6d-diagnosis-title]");
    speak(h, "Follow-up");
    expectAligned(h, "nextVisitNote", "#nextVisitNote");
    speak(h, "End");
    speak(h, "must remain ignored");
    expect(h.session).toBe("idle");
    expect(h.notes.nextVisitNote).toBe("");
    expect(h.consumed).toEqual(expect.arrayContaining(["Pause", "Resume", "Diagnosis", "Confirmed", "Diagnosis note", "Undo", "Investigation orders", "Previous", "Follow-up", "End"]));
  });
});
