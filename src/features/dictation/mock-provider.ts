import type {
  VoiceLatencySnapshot,
  VoiceTranscriptionProvider,
  VoiceTranscriptionSession,
} from "./provider";

export type MockVoiceScenario =
  | "success"
  | "permission-denied"
  | "no-microphone"
  | "no-speech"
  | "timeout"
  | "disconnect";

export interface MockVoiceFixture {
  scenario?: MockVoiceScenario;
  transcript?: string;
  interimTranscript?: string;
}

const ENGLISH = "Fever for three days with dry cough. BP 120/80 mmHg.";
const BANGLA = "তিন দিন ধরে জ্বর এবং শুকনো কাশি। BP 120/80 mmHg।";
const BANGLISH = "Patient er three din dhore fever, dry cough ache. BP 120/80 mmHg.";

export function mockTranscriptFor(language: string): string {
  if (language === "bn") return BANGLA;
  if (language === "mixed") return BANGLISH;
  return ENGLISH;
}

/**
 * Deterministic development provider. It never opens a microphone, network
 * connection, provider token route, or external API. It deliberately mirrors
 * the production lifecycle so M6A UI/error paths can be exercised for free.
 *
 * `id` stays "deepgram" only because the pre-M6 provider interface currently
 * narrows the identifier to that literal; M6A selects this object explicitly
 * and exposes `data-voice-mode="mock"`, so this does not activate Deepgram.
 */
export function createMockVoiceTranscriptionProvider(
  fixture: MockVoiceFixture = {},
): VoiceTranscriptionProvider {
  return {
    id: "deepgram",
    privacyNotice: "Mock voice mode: no audio leaves this device and no external speech API is called.",
    isSupported: () => true,
    createSession({ language, callbacks }): VoiceTranscriptionSession {
      let terminal = false;
      let stopped = false;
      const transcript = fixture.transcript ?? mockTranscriptFor(language);
      const interim = fixture.interimTranscript ?? transcript.split(/(?<=[.!?।])\s+/)[0] ?? transcript;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const later = (fn: () => void, ms: number) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!terminal) fn();
        }, ms);
        timers.add(timer);
      };
      const clear = () => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      };
      const fail = (code: string) => {
        if (terminal) return;
        terminal = true;
        clear();
        callbacks.onError(code);
      };
      const end = () => {
        if (terminal) return;
        terminal = true;
        clear();
        callbacks.onLatency({ micReadyMs: 0, providerConnectedMs: 0, firstTranscriptMs: 120, stopToFinalMs: 40 });
        callbacks.onEnd(transcript);
      };

      return {
        start() {
          callbacks.onPhase("connecting");
          const scenario = fixture.scenario ?? "success";
          if (scenario === "permission-denied") return later(() => fail("not-allowed"), 40);
          if (scenario === "no-microphone") return later(() => fail("audio-capture"), 40);
          if (scenario === "timeout") return later(() => fail("first-transcript-timeout"), 120);
          if (scenario === "disconnect") return later(() => fail("network"), 120);
          if (scenario === "no-speech") return later(() => fail("no-speech"), 120);

          later(() => {
            callbacks.onPhase("listening");
            const latency: VoiceLatencySnapshot = { micReadyMs: 0, providerConnectedMs: 0 };
            callbacks.onLatency(latency);
          }, 30);
          later(() => callbacks.onTranscript({ text: interim, isFinal: false }), 90);
          later(() => callbacks.onTranscript({ text: transcript, isFinal: true }), 160);
          later(() => {
            if (stopped) end();
          }, 220);
        },
        stop() {
          if (terminal) return;
          stopped = true;
          callbacks.onPhase("finalizing");
          later(end, 45);
        },
        abort() {
          terminal = true;
          clear();
        },
      };
    },
  };
}

export const mockVoiceTranscriptionProvider = createMockVoiceTranscriptionProvider();
