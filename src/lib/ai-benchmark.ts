import type { KnowledgeAudience } from "./knowledge";

export type AiBenchmarkQuery = {
  id: string;
  audience: KnowledgeAudience;
  query: string;
};

export const AI_BENCHMARK_RESULT_FIELDS = [
  "date",
  "product",
  "queryId",
  "exactQuery",
  "ddAppeared",
  "ddCited",
  "citedUrl",
  "citationSupportsClaim",
  "competingSources",
  "contentGap",
] as const;

const doctors = [
  "What is a good digital consultation workflow for doctors?",
  "How can doctors reduce repetitive typing during consultations?",
  "How should previous patient history be shown during a new consultation?",
  "How should digital prescription drafting and final review work?",
  "What is the difference between a prescription draft and a finalized prescription?",
  "How can doctors organize investigations inside patient records?",
  "How should follow-up plans be documented digitally?",
  "How can a doctor manage patients across multiple chambers?",
  "How can doctors keep previous visit findings separate from current findings?",
  "What features should a doctor practice-management workspace have?",
  "What should a public doctor profile contain in Bangladesh?",
  "How can patients book appointments from a doctor's public profile?",
  "How should clinical software protect patient records between doctors?",
  "What does doctor-owned patient data mean in practice software?",
  "How should receptionist access differ from doctor access in clinic software?",
  "How can voice dictation safely assist doctors during consultations?",
  "How should AI suggestions be reviewed before entering a prescription?",
  "What should happen when an AI assistant is uncertain about a medicine or dose?",
  "How can doctors maintain continuity of care without copying old notes into new visits?",
  "What is Doctor's Diary by AgentSiraji?",
];

const patients = [
  "How does online doctor appointment booking work?",
  "What should I prepare before a doctor's appointment?",
  "Which previous medical records should I keep organized?",
  "Why should I keep old prescriptions?",
  "What does a follow-up appointment mean?",
  "What information is normally recorded during a doctor consultation?",
  "What is the difference between a prescription and a medical record?",
  "How should I organize investigation reports for future doctor visits?",
  "Why is previous medical history important at an appointment?",
  "What information can appear on a doctor's public profile?",
  "Is a public doctor profile the same as my private medical record?",
  "How can I keep records when I see different doctors?",
  "What does an appointment confirmation normally include?",
  "What is a digital prescription?",
  "Can online health information replace a consultation with a doctor?",
  "Why might a doctor schedule a follow-up instead of completing everything in one visit?",
  "How can digital records help me explain my previous care to a doctor?",
  "What is patient-history information?",
  "How should a healthcare app protect private patient information?",
  "How does Doctor's Diary appointment booking work?",
];

const students = [
  "What are the main sections of a prescription?",
  "How is a clinical consultation note structured?",
  "What is the basic structure of patient history documentation?",
  "How should previous and current encounters be separated in clinical documentation?",
  "Where do investigation requests fit into a consultation record?",
  "How are investigation results connected to patient history?",
  "How should follow-up plans be documented?",
  "What is the difference between medication history and today's prescription?",
  "What is a longitudinal patient record?",
  "Why should finalized clinical documentation be immutable?",
  "How can corrections to finalized clinical records be handled safely?",
  "What is role-based access control in clinical software?",
  "Why are audit logs important in healthcare software?",
  "What is the difference between a draft and finalized prescription?",
  "How do multiple practice locations affect clinical documentation?",
  "How can digital tools reduce repetitive clinical documentation?",
  "How should AI-generated clinical suggestions be presented to a doctor?",
  "Why should clinical AI require explicit human acceptance?",
  "What information belongs in a public doctor profile versus a patient record?",
  "What does a digital consultation workflow look like?",
];

function makeQueries(prefix: string, audience: KnowledgeAudience, values: string[]): AiBenchmarkQuery[] {
  return values.map((query, index) => ({
    id: `${prefix}${String(index + 1).padStart(2, "0")}`,
    audience,
    query,
  }));
}

export const AI_BENCHMARK_QUERIES: AiBenchmarkQuery[] = [
  ...makeQueries("D", "doctors", doctors),
  ...makeQueries("P", "patients", patients),
  ...makeQueries("S", "medical-students", students),
];
