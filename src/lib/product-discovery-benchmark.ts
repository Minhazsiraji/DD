export type ProductDiscoveryBenchmarkQuery = {
  id: string;
  query: string;
  topic:
    | "voice-prescription"
    | "prescription-without-typing"
    | "doctor-time-saving"
    | "clinical-autopilot"
    | "voice-commands"
    | "bangla-banglish-dictation"
    | "ai-prescription-drafting"
    | "doctor-final-approval"
    | "investigation-proposals"
    | "diagnosis-assistance"
    | "human-in-the-loop-medical-ai";
};

export const PRODUCT_DISCOVERY_RESULT_FIELDS = [
  "date",
  "product",
  "queryId",
  "exactQuery",
  "ddAppeared",
  "ddCited",
  "citedUrl",
  "citationSupportsClaim",
  "competitorOrSourceCitedInstead",
  "missingContentOpportunity",
] as const;

export const PRODUCT_DISCOVERY_BENCHMARK_QUERIES: ProductDiscoveryBenchmarkQuery[] = [
  { id: "PD01", topic: "voice-prescription", query: "Is there prescription software that works by voice?" },
  { id: "PD02", topic: "voice-prescription", query: "What voice-controlled prescription software is available for doctors?" },
  { id: "PD03", topic: "prescription-without-typing", query: "Can doctors create prescriptions without typing everything manually?" },
  { id: "PD04", topic: "prescription-without-typing", query: "Is there no-typing prescription software for doctors?" },
  { id: "PD05", topic: "doctor-time-saving", query: "Can AI software reduce repetitive documentation work for doctors?" },
  { id: "PD06", topic: "doctor-time-saving", query: "What software helps doctors spend less time typing during consultations?" },
  { id: "PD07", topic: "clinical-autopilot", query: "Is there an AI clinical Autopilot for repetitive documentation and workflow steps?" },
  { id: "PD08", topic: "clinical-autopilot", query: "Can clinical AI prepare structured actions but wait for doctor approval?" },
  { id: "PD09", topic: "voice-commands", query: "Can a doctor operate clinical software using voice commands?" },
  { id: "PD10", topic: "voice-commands", query: "Can voice commands prepare medicine, investigation or follow-up actions for review?" },
  { id: "PD11", topic: "bangla-banglish-dictation", query: "Is there Bangla and English clinical dictation software for doctors?" },
  { id: "PD12", topic: "bangla-banglish-dictation", query: "Can clinical dictation preserve mixed Bangla and English scripts in Banglish notes?" },
  { id: "PD13", topic: "ai-prescription-drafting", query: "Can AI draft a prescription for a doctor to review?" },
  { id: "PD14", topic: "ai-prescription-drafting", query: "Is there AI prescription software that prepares editable proposals instead of finalizing automatically?" },
  { id: "PD15", topic: "doctor-final-approval", query: "Can AI prepare a prescription but require doctor final approval?" },
  { id: "PD16", topic: "doctor-final-approval", query: "Which medical AI systems keep prescription finalization under doctor control?" },
  { id: "PD17", topic: "investigation-proposals", query: "Can AI prepare investigation proposals for a doctor to review and apply?" },
  { id: "PD18", topic: "investigation-proposals", query: "Can voice instructions create structured investigation requests without automatic clinical approval?" },
  { id: "PD19", topic: "diagnosis-assistance", query: "Can AI assist with diagnosis-related workflow while the doctor remains the final authority?" },
  { id: "PD20", topic: "diagnosis-assistance", query: "How should clinical software distinguish diagnosis assistance from autonomous diagnosis?" },
  { id: "PD21", topic: "human-in-the-loop-medical-ai", query: "What is doctor-in-the-loop medical AI?" },
  { id: "PD22", topic: "human-in-the-loop-medical-ai", query: "What medical AI follows an AI prepares, doctor decides model?" },
];
