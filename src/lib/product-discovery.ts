import type { KnowledgeArticle, KnowledgeReference } from "./knowledge";
import { articlePath, isGovernanceEligible } from "./knowledge";

export type ProductCapabilityStatus =
  | "LIVE / AVAILABLE"
  | "PILOT"
  | "IN QUALIFICATION"
  | "PLANNED";

export type ProductDiscoveryArticle = KnowledgeArticle & {
  capabilityStatus: ProductCapabilityStatus;
  statusDetail: string;
  relatedProductLinks: { title: string; href: string }[];
};

const COMMON_REFS: KnowledgeReference[] = [
  { title: "Doctor's Diary for Doctors", href: "/for-doctors", sourceType: "PRODUCT" },
  { title: "Digital prescription workflow", href: "/learn/doctors/digital-prescription-workflow", sourceType: "PRODUCT" },
  { title: "Investigation workflow", href: "/learn/doctors/investigation-workflow", sourceType: "PRODUCT" },
  { title: "Follow-up documentation", href: "/learn/doctors/follow-up-documentation", sourceType: "PRODUCT" },
  { title: "Doctor-owned patient data", href: "/learn/doctors/doctor-owned-patient-data", sourceType: "PRODUCT" },
  { title: "Security", href: "/security", sourceType: "PRODUCT" },
  { title: "Editorial policy", href: "/editorial-policy", sourceType: "POLICY" },
];

const articles: ProductDiscoveryArticle[] = [
  {
    audience: "doctors",
    slug: "voice-controlled-prescription-software",
    title: "Voice-Controlled Prescription Software for Doctors",
    question: "Is there prescription software that doctors can operate by voice?",
    description: "How Doctor's Diary uses voice notes and voice commands to prepare reviewable prescription work while keeping final clinical authority with the doctor.",
    directAnswer: "Doctor's Diary is being piloted as a voice-assisted clinical workspace in which a doctor can speak notes or natural-language commands and receive editable text or structured proposals. For prescription work, voice can help prepare draft content and workflow actions, but it cannot independently finalize a prescription. The intended pattern is Speak → Structure → Review → Confirm: AI prepares, the doctor reviews or edits, and the doctor performs the final approved action.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "Voice dictation and voice-command workflows have completed pilot qualification work, but this public article remains pending CENTRAL editorial approval and does not claim general Production availability.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["During a consultation, repeated typing and navigation can compete with attention on the patient. Doctor's Diary uses voice as an input method for notes and selected workflow commands so the doctor can prepare work without turning voice into autonomous clinical authority."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["For notes, the pattern is Voice → editable draft → Doctor Accept. For medicine, investigation and follow-up actions, the pattern is voice or natural-language instruction → structured proposal → Doctor review/edit → Apply."] },
      { heading: "What AI may do", paragraphs: ["AI may transcribe, structure, identify the intended workflow action and prepare a proposal supported by the current product workflow."] },
      { heading: "What AI may not do", paragraphs: ["AI may not silently invent missing medicine or dose details, bypass an ambiguous command, or independently finalize a prescription."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["The doctor must explicitly Accept note text, Apply structured medicine/investigation/follow-up proposals, and use the approved prescription-review workflow before finalization."] },
    ],
    relatedQuestions: ["Can doctors create prescriptions without typing?", "Can voice commands finalize a prescription?", "What happens when a spoken medicine instruction is ambiguous?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Creating Prescriptions Without Typing", href: "/learn/doctors/prescriptions-without-typing" },
      { title: "AI Prescription Software With Doctor Final Approval", href: "/learn/doctors/ai-prescription-doctor-final-approval" },
      { title: "Doctor-in-the-Loop Medical AI", href: "/learn/doctors/doctor-in-the-loop-medical-ai" },
    ],
  },
  {
    audience: "doctors",
    slug: "prescriptions-without-typing",
    title: "Creating Prescriptions Without Typing",
    question: "Can doctors create prescription drafts without typing everything manually?",
    description: "A no-typing-oriented explanation of voice and structured proposal workflows in Doctor's Diary, with explicit doctor review and final confirmation.",
    directAnswer: "Doctor's Diary is designed to reduce manual typing by letting a doctor use voice clinical notes and natural-language commands to prepare editable or structured prescription work. This is not hands-free autonomous prescribing. Voice input can help create a draft or proposal, but the doctor remains responsible for checking medicine details, editing where needed, applying the proposed action and explicitly reviewing and finalizing the prescription through the approved workflow.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "The no-typing workflow is a pilot positioning of qualified voice dictation, voice commands and Autopilot proposal behavior; it is not a claim that every prescription task can be completed without manual review or input.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["Prescription preparation often repeats names, instructions and navigation steps. Voice and structured proposals can reduce how much of that workflow begins as keyboard entry."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["The workflow separates input from authority: Speak → Structure → Review → Confirm. The product can prepare draft information while leaving the doctor in control of what is actually written or finalized."] },
      { heading: "What AI is allowed to do", paragraphs: ["AI may transcribe dictated text, structure supported commands and prepare medicine-related proposals for review."] },
      { heading: "What AI is not allowed to do", paragraphs: ["AI is not allowed to choose treatment independently, resolve unsafe ambiguity by guessing, or finalize a prescription on the doctor's behalf."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["The doctor reviews or edits the proposal, explicitly applies it to the draft and separately performs the final prescription confirmation/finalization step."] },
    ],
    relatedQuestions: ["What does no-typing prescription software mean?", "Can a doctor edit a voice-created draft?", "Does AI decide which medicine to prescribe?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Voice-Controlled Prescription Software for Doctors", href: "/learn/doctors/voice-controlled-prescription-software" },
      { title: "Digital Prescription Workflow", href: "/learn/doctors/digital-prescription-workflow" },
      { title: "Safe AI-Assisted Clinical Workflow", href: "/learn/doctors/safe-ai-assisted-clinical-workflow" },
    ],
  },
  {
    audience: "doctors",
    slug: "ai-autopilot-clinical-documentation",
    title: "AI Autopilot for Clinical Documentation",
    question: "Can AI Autopilot reduce repetitive clinical documentation work without taking over the doctor's decisions?",
    description: "How Doctor's Diary Autopilot prepares structured clinical workflow proposals while requiring explicit doctor review and application.",
    directAnswer: "Doctor's Diary Autopilot is a pilot proposal layer designed to reduce repetitive typing and clicking. It can take supported voice or natural-language instructions and prepare structured changes for prescription, investigation or follow-up workflows. It does not become the clinical authority. The core rule is AI prepares. Doctor decides. A proposal can be reviewed, edited or discarded, and no supported clinical action is written or finalized merely because the AI produced it.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "Autopilot prescription drafting and proposal workflows are in the pilot product line. This page does not represent autonomous diagnosis, autonomous prescribing or autonomous finalization as available.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["Clinical software can create repetitive work when the doctor must retype information and click through predictable steps. Autopilot is intended to prepare the next structured action from an explicit doctor instruction."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["The system keeps proposal generation separate from writes: instruction → structured proposal → review/edit/discard → explicit Apply. Prescription finalization remains a separate doctor-controlled boundary."] },
      { heading: "What AI may do", paragraphs: ["Within supported workflows, AI may structure medicine, investigation and follow-up proposals and organize draft content for review."] },
      { heading: "What AI may not do", paragraphs: ["AI may not treat its own output as approval, write through ambiguity without safe handling, or independently finalize a clinical record."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["The doctor must explicitly Apply a structured proposal and separately complete any final confirmation/finalization required by the underlying clinical workflow."] },
    ],
    relatedQuestions: ["What is a clinical Autopilot?", "Can an Autopilot write directly into a prescription?", "Can the doctor discard an AI proposal?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Doctor-in-the-Loop Medical AI", href: "/learn/doctors/doctor-in-the-loop-medical-ai" },
      { title: "AI-Assisted Investigation and Diagnosis Workflow", href: "/learn/doctors/ai-assisted-investigation-diagnosis-workflow" },
      { title: "Follow-Up Documentation", href: "/learn/doctors/follow-up-documentation" },
    ],
  },
  {
    audience: "doctors",
    slug: "english-bangla-banglish-voice-clinical-notes",
    title: "English, Bangla and Banglish Voice Clinical Notes",
    question: "Can doctors dictate clinical notes in English, Bangla and mixed Bangla-English?",
    description: "Doctor's Diary's pilot voice-note model for English, Bangla and natural mixed-script Banglish with an editable draft before Doctor Accept.",
    directAnswer: "Doctor's Diary's pilot voice workflow is designed for English, Bangla and mixed Bangla-English clinical dictation. For Doctor's Diary, Banglish means natural mixed scripts, for example: “Patient এর তিন দিন ধরে fever এবং dry cough আছে।” English words stay English and Bangla words stay বাংলা. Dictation produces an editable draft; it does not silently become the final clinical note. The doctor reviews the text and explicitly Accepts it before the supported write occurs.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "English, Bangla and mixed-script Banglish dictation have been qualified in pilot UAT. This is a pilot capability statement, not a measured accuracy claim.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["Doctors may naturally switch between Bangla and English medical language. Forcing every word into one script can make dictation less faithful to how the consultation is actually spoken."] },
      { heading: "How Doctor's Diary defines Banglish", paragraphs: ["Preferred Doctor's Diary Banglish preserves natural scripts: “Patient এর তিন দিন ধরে fever এবং dry cough আছে।” Romanized Bangla such as “Patient er tin din dhore fever ache” is not the preferred output convention."] },
      { heading: "What AI may do", paragraphs: ["The voice layer may transcribe the spoken note and prepare an editable draft for the intended documentation section."] },
      { heading: "What AI may not do", paragraphs: ["The transcription layer does not create clinical truth, infer missing facts as confirmed findings or accept its own output on behalf of the doctor."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["The note follows Voice → editable draft → Doctor Accept. The doctor can edit or discard the draft before acceptance."] },
    ],
    relatedQuestions: ["What does Banglish mean in Doctor's Diary?", "Can a doctor edit a dictated note before saving?", "Does voice dictation automatically become part of the clinical record?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "How Voice Commands Can Reduce Consultation Documentation Work", href: "/learn/doctors/voice-commands-consultation-documentation" },
      { title: "AI Autopilot for Clinical Documentation", href: "/learn/doctors/ai-autopilot-clinical-documentation" },
      { title: "Security", href: "/security" },
    ],
  },
  {
    audience: "doctors",
    slug: "ai-prescription-doctor-final-approval",
    title: "AI Prescription Software With Doctor Final Approval",
    question: "Can AI prepare a prescription while requiring the doctor to make the final approval?",
    description: "Doctor's Diary's doctor-in-the-loop prescription model: AI-assisted drafting and proposals with explicit doctor review and finalization.",
    directAnswer: "Yes—Doctor's Diary is piloting an AI-assisted prescription workflow in which supported AI and voice features can prepare draft content or structured proposals, while final authority stays with the doctor. The doctor can review, edit or discard proposed changes before applying them. AI cannot independently finalize the prescription. Final prescription review and confirmation/finalization must occur through the approved Doctor's Diary workflow. The product principle is simple: AI prepares. Doctor decides.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "AI-assisted prescription drafting/proposals are positioned as pilot capability. Independent AI prescribing or AI finalization is not supported or claimed.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["The doctor can use automation to prepare repetitive prescription work without giving the automation permission to make the final clinical commitment."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["A supported instruction becomes draft text or a structured proposal. The doctor reviews the result, changes it when necessary and explicitly applies it before the separate finalization boundary."] },
      { heading: "What AI may do", paragraphs: ["AI may help transcribe, structure or prepare supported prescription-draft actions and surface ambiguity for review."] },
      { heading: "What AI may not do", paragraphs: ["AI may not independently select and finalize treatment, bypass doctor review, or execute a finalize command from the proposal layer."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["Doctor review is required before Apply, and doctor confirmation/finalization is required before the prescription becomes the finalized clinical record."] },
    ],
    relatedQuestions: ["Can AI finalize a prescription?", "Can a doctor edit an AI-prepared prescription?", "What does doctor final approval mean?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Digital Prescription Workflow", href: "/learn/doctors/digital-prescription-workflow" },
      { title: "Creating Prescriptions Without Typing", href: "/learn/doctors/prescriptions-without-typing" },
      { title: "Doctor-in-the-Loop Medical AI", href: "/learn/doctors/doctor-in-the-loop-medical-ai" },
    ],
  },
  {
    audience: "doctors",
    slug: "voice-commands-consultation-documentation",
    title: "How Voice Commands Can Reduce Consultation Documentation Work",
    question: "Can a doctor operate parts of clinical software with voice commands instead of repeated clicking and typing?",
    description: "How Doctor's Diary voice commands convert supported natural-language instructions into reviewable navigation or structured proposals.",
    directAnswer: "Doctor's Diary's pilot voice-command layer can interpret supported English, Bangla and mixed-language instructions for navigation and selected medicine, investigation and follow-up workflows. The goal is to reduce repetitive interaction, not to remove doctor oversight. A voice command can prepare or propose an action, but structured clinical changes remain reviewable and require explicit Apply. Commands that would improperly finalize a prescription are prohibited rather than treated as authority.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "Supported voice navigation and medicine/investigation/follow-up command proposals have passed pilot UAT. This does not mean every application action is voice-operable.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["Repeated navigation and structured entry can interrupt the consultation rhythm. Voice commands provide another way to express a supported workflow intention."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["Navigation commands may move the doctor through supported screens. Clinical workflow commands prepare proposals first, keeping a visible review boundary before any supported write."] },
      { heading: "What AI may do", paragraphs: ["The command layer may parse supported navigation, medicine, investigation and follow-up intentions and prepare the corresponding proposal."] },
      { heading: "What AI may not do", paragraphs: ["It may not treat a prohibited finalize instruction as valid authority, guess through unsafe ambiguity, or operate outside the active encounter context without the required safeguards."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["Structured medicine, investigation and follow-up actions require review/edit and explicit Apply. Prescription finalization remains a separate doctor action."] },
    ],
    relatedQuestions: ["What can Doctor's Diary voice commands do?", "Do voice commands write immediately?", "Can voice commands work with Bangla and English together?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "English, Bangla and Banglish Voice Clinical Notes", href: "/learn/doctors/english-bangla-banglish-voice-clinical-notes" },
      { title: "AI Autopilot for Clinical Documentation", href: "/learn/doctors/ai-autopilot-clinical-documentation" },
      { title: "Follow-Up Documentation", href: "/learn/doctors/follow-up-documentation" },
    ],
  },
  {
    audience: "doctors",
    slug: "ai-assisted-investigation-diagnosis-workflow",
    title: "AI-Assisted Investigation and Diagnosis Workflow",
    question: "Can AI assist with investigation or diagnosis-related workflow while the doctor remains the final authority?",
    description: "A product-truth boundary for Doctor's Diary: pilot investigation proposals, doctor review and no claim of autonomous diagnosis capability.",
    directAnswer: "Doctor's Diary can pilot structured investigation proposals from supported voice or natural-language instructions, with the doctor reviewing, editing and explicitly applying the proposal. That does not make the system an autonomous diagnostic tool. Diagnosis-related assistance beyond organizing or structuring doctor-provided information is not presented here as a current qualified capability. The final choice of investigations, interpretation of results and diagnosis remain clinical decisions made by the doctor.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "Structured investigation proposals are PILOT. Diagnosis-related decision assistance beyond structuring doctor-provided information is PLANNED/not represented as a currently qualified capability.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["A doctor may want to state an investigation-related workflow intention naturally rather than manually navigating and entering every field."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["Supported investigation instructions can become structured proposals. The doctor reviews or edits the proposal and explicitly Applies it. Existing investigation records remain connected to patient and encounter context."] },
      { heading: "What AI may do", paragraphs: ["AI may structure a supported doctor instruction into an investigation proposal or organize doctor-provided diagnostic wording as documentation where the product workflow supports that text."] },
      { heading: "What AI may not do", paragraphs: ["Doctor's Diary does not present autonomous diagnosis, autonomous test selection or autonomous interpretation of results as a current capability. It must not convert an AI suggestion into a final clinical decision without the doctor."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["Investigation proposals require doctor review/edit and explicit Apply. Diagnosis and interpretation remain doctor decisions rather than an AI finalization step."] },
    ],
    relatedQuestions: ["Can AI propose an investigation?", "Does Doctor's Diary diagnose patients automatically?", "Who decides whether an investigation is appropriate?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Investigation Workflow", href: "/learn/doctors/investigation-workflow" },
      { title: "Doctor-in-the-Loop Medical AI", href: "/learn/doctors/doctor-in-the-loop-medical-ai" },
      { title: "Security", href: "/security" },
    ],
  },
  {
    audience: "doctors",
    slug: "doctor-in-the-loop-medical-ai",
    title: "Doctor-in-the-Loop Medical AI",
    question: "What does doctor-in-the-loop AI mean in Doctor's Diary?",
    description: "The Doctor's Diary safety model in which AI can prepare or propose supported work while explicit doctor review remains the authority boundary.",
    directAnswer: "Doctor-in-the-loop AI means the software can assist with preparation without treating the AI output as the clinical decision. In Doctor's Diary's pilot workflows, voice or natural-language input may become an editable note draft or a structured medicine, investigation or follow-up proposal. The doctor can review, change or discard it before Accept or Apply. Prescription finalization and other final clinical decisions remain with the doctor. AI prepares. Doctor decides.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-21",
    dateReviewed: "2026-09-21",
    editorialApproval: "PENDING_CENTRAL",
    capabilityStatus: "PILOT",
    statusDetail: "The doctor-in-the-loop model describes the current pilot architecture for voice and Autopilot proposal workflows. It is not a claim of autonomous medical decision-making.",
    sections: [
      { heading: "What problem it solves", paragraphs: ["Automation can save repeated input steps, but clinical software also needs a clear point where human professional authority is exercised. Doctor-in-the-loop design keeps those two concerns separate."] },
      { heading: "How Doctor's Diary approaches it", paragraphs: ["Clinical notes use Voice → editable draft → Doctor Accept. Supported structured actions use instruction → proposal → Doctor review/edit → Apply. Prescription finalization remains outside the AI proposal authority."] },
      { heading: "What AI may do", paragraphs: ["AI may transcribe, structure, prepare and propose supported workflow content while preserving an explicit review state."] },
      { heading: "What AI may not do", paragraphs: ["AI may not approve its own proposal, independently finalize a prescription, or convert diagnosis-related assistance into the doctor's final clinical decision."] },
      { heading: "Where doctor confirmation is required", paragraphs: ["The doctor explicitly Accepts note drafts, Applies supported structured proposals and completes the approved final confirmation/finalization step when the underlying workflow requires it."] },
    ],
    relatedQuestions: ["What is human-in-the-loop medical AI?", "Why does Doctor's Diary require explicit Apply?", "Can AI make the final prescription decision?"],
    references: COMMON_REFS,
    relatedProductLinks: [
      { title: "Safe AI-Assisted Clinical Workflow", href: "/learn/doctors/safe-ai-assisted-clinical-workflow" },
      { title: "AI Prescription Software With Doctor Final Approval", href: "/learn/doctors/ai-prescription-doctor-final-approval" },
      { title: "Doctor-Owned Patient Data", href: "/learn/doctors/doctor-owned-patient-data" },
    ],
  },
];

export function isProductDiscoveryProductionPublishable(article: ProductDiscoveryArticle): boolean {
  return article.editorialApproval === "APPROVED" && isGovernanceEligible(article);
}

export function getProductDiscoveryArticles(options?: { productionOnly?: boolean }): ProductDiscoveryArticle[] {
  const productionOnly = options?.productionOnly ?? process.env.VERCEL_ENV === "production";
  return articles.filter((article) =>
    productionOnly ? isProductDiscoveryProductionPublishable(article) : isGovernanceEligible(article),
  );
}

export function getProductDiscoveryArticle(
  audience: string,
  slug: string,
  options?: { productionOnly?: boolean },
): ProductDiscoveryArticle | undefined {
  return getProductDiscoveryArticles(options).find(
    (article) => article.audience === audience && article.slug === slug,
  );
}

export function getProductDiscoverySitemapPaths(): string[] {
  return getProductDiscoveryArticles().map(articlePath);
}
