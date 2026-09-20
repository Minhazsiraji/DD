export type KnowledgeAudience = "doctors" | "patients" | "medical-students";
export type ContentClass = "PRODUCT" | "PROFESSIONAL_WORKFLOW" | "PATIENT_CLINICAL";
export type EditorialApproval = "PENDING_CENTRAL" | "APPROVED";

export type KnowledgeReference = {
  title: string;
  href: string;
  sourceType: "PRODUCT" | "POLICY" | "AUTHORITATIVE_EVIDENCE";
};

export type KnowledgeSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type KnowledgeArticle = {
  audience: KnowledgeAudience;
  slug: string;
  title: string;
  question: string;
  description: string;
  directAnswer: string;
  contentClass: ContentClass;
  hasClinicalClaims: boolean;
  authorSlug: string;
  reviewerSlug?: string;
  datePublished: string;
  dateReviewed: string;
  editorialApproval: EditorialApproval;
  sections: KnowledgeSection[];
  relatedQuestions: string[];
  references: KnowledgeReference[];
};

export type PublicAuthor = {
  slug: string;
  name: string;
  kind: "Organization" | "Person";
  role: string;
  bio: string;
};

export type PublicReviewer = {
  slug: string;
  name: string;
  credentials: string[];
  bio: string;
  identityVerified: boolean;
  credentialsVerified: boolean;
  consentObtained: boolean;
};

export const AUDIENCE_LABELS: Record<KnowledgeAudience, string> = {
  doctors: "Doctors",
  patients: "Patients",
  "medical-students": "Medical students",
};

export const PUBLIC_AUTHORS: PublicAuthor[] = [
  {
    slug: "agentsiraji",
    name: "AgentSiraji",
    kind: "Organization",
    role: "Publisher of Doctor's Diary",
    bio: "AgentSiraji publishes Doctor's Diary product documentation and workflow education. Medical or patient-facing clinical content follows the separate medical-content policy.",
  },
];

// Deliberately empty until identity, credentials and consent are verified.
export const PUBLIC_REVIEWERS: PublicReviewer[] = [];

const PRODUCT_REFS: KnowledgeReference[] = [
  { title: "Doctor's Diary for Doctors", href: "/for-doctors", sourceType: "PRODUCT" },
  { title: "Security", href: "/security", sourceType: "PRODUCT" },
  { title: "Editorial policy", href: "/editorial-policy", sourceType: "POLICY" },
];

const articles: KnowledgeArticle[] = [
  {
    audience: "doctors",
    slug: "digital-consultation-workflow",
    title: "Digital Consultation Workflow for Doctors",
    question: "What should a practical digital consultation workflow look like?",
    description: "A workflow-first explanation of how Doctor's Diary keeps current consultation work distinct while retaining previous context.",
    directAnswer: "A practical digital consultation workflow should keep the current encounter focused while making earlier history easy to review. In Doctor's Diary, the intended pattern is to open the patient context, document today's encounter separately, review investigations and medicines as needed, prepare follow-up and prescription work, and finalize only after the doctor has reviewed the result. Previous findings remain historical context rather than being silently merged into the new visit.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Keep today's encounter separate", paragraphs: ["The current consultation should be a new record of today's work. Earlier encounters remain available for context, but the software should not rewrite old observations as if they were made today."] },
      { heading: "Move through one clinical loop", paragraphs: ["Doctor's Diary is organized around a repeatable loop: patient context, consultation notes, investigations, prescription preparation and follow-up. The doctor remains responsible for reviewing what is recorded before finalization."] },
      { heading: "Why this helps", paragraphs: ["A workflow-centered record reduces searching and duplicate entry without sacrificing chronology. The design goal is continuity with clear encounter boundaries, not automatic clinical decision-making."] },
    ],
    relatedQuestions: ["How should previous patient history appear during a new visit?", "What should happen before a prescription is finalized?", "How should follow-up be documented?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "digital-prescription-workflow",
    title: "Digital Prescription Workflow: Draft, Review and Finalize",
    question: "How should a digital prescription workflow separate drafting from finalization?",
    description: "How Doctor's Diary treats prescription preparation as a reviewable draft before an immutable finalized record.",
    directAnswer: "A safe digital prescription workflow should separate preparation from finalization. Doctor's Diary treats prescription content as a draft while the doctor is still reviewing it. Suggested or entered items can be edited or discarded during that stage. Finalization is a distinct doctor-controlled action; once finalized, the prescription is treated as a completed clinical record rather than an editable working note. This page describes the software workflow, not what medicine or dose should be prescribed.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Draft first", paragraphs: ["During preparation, the doctor can review the medicine list and associated prescription details before committing the record."] },
      { heading: "Make finalization explicit", paragraphs: ["Finalization should not be hidden inside a suggestion, navigation command or background process. The final action belongs to the doctor."] },
      { heading: "Preserve the finalized record", paragraphs: ["After finalization, later corrections should be traceable rather than silently rewriting what was originally finalized."] },
    ],
    relatedQuestions: ["What is the difference between a draft and finalized prescription?", "Can an AI command finalize a prescription?", "Why should finalized records be immutable?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "patient-history-visit-continuity",
    title: "Patient History and Visit Continuity in a Digital Practice",
    question: "How can digital records preserve patient continuity without copying old findings into a new visit?",
    description: "A documentation pattern for reviewing longitudinal context while keeping each consultation historically distinct.",
    directAnswer: "Patient continuity works best when earlier encounters remain easy to retrieve but are not automatically copied into the current visit. Doctor's Diary is designed to show relevant historical context while recording today's consultation separately. That keeps the timeline understandable: a doctor can see what was documented before, identify what belongs to the present encounter, and maintain follow-up context without turning old information into new findings.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "History is context, not today's note", paragraphs: ["Longitudinal records are valuable because they preserve chronology. The software should help a doctor review earlier material without presenting it as newly observed information."] },
      { heading: "Link follow-up to the timeline", paragraphs: ["A follow-up plan belongs to an encounter and can inform the next visit. Keeping that relationship visible supports continuity while preserving the original record."] },
    ],
    relatedQuestions: ["What is a longitudinal patient record?", "How should current and previous encounters be separated?", "How does follow-up connect visits?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "investigation-workflow",
    title: "Managing Investigations and Results in the Consultation Workflow",
    question: "Where should investigations fit inside a digital consultation record?",
    description: "How Doctor's Diary keeps investigation requests and recorded results connected to patient and encounter context.",
    directAnswer: "Investigations should sit inside the patient's longitudinal record while remaining attributable to the relevant consultation context. In Doctor's Diary, the workflow is designed so a doctor can record investigation-related information, revisit it later and see it alongside the rest of the patient's history. The purpose is organizational continuity and traceability; the software does not replace the doctor's interpretation of a result or decide what investigation is clinically appropriate.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Keep the patient and encounter context", paragraphs: ["An investigation entry is more useful when it remains connected to the patient record and the workflow in which it was requested or reviewed."] },
      { heading: "Separate storage from interpretation", paragraphs: ["Doctor's Diary can organize investigation information, but clinical interpretation remains a professional decision by the doctor."] },
    ],
    relatedQuestions: ["How are investigation results connected to history?", "Can a digital record keep investigation history?", "Does the software interpret investigation results?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "follow-up-documentation",
    title: "Follow-Up Documentation: Keeping the Next Visit Clear",
    question: "How should follow-up information be documented without rewriting the original consultation?",
    description: "A workflow pattern for recording next-visit context while preserving the original encounter.",
    directAnswer: "Follow-up information should be attached to the encounter where the plan was made, then remain visible as context for the next visit. Doctor's Diary is designed to preserve the original consultation while carrying forward the follow-up information needed for continuity. The next consultation becomes a new encounter rather than an edit of the previous one, so the record can show what happened at each point in time.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Anchor the plan to its encounter", paragraphs: ["The follow-up plan should remain part of the consultation that created it. That preserves the historical record."] },
      { heading: "Start the next visit as a new encounter", paragraphs: ["At the next visit, the earlier plan can be reviewed, but today's documentation should remain a distinct record."] },
    ],
    relatedQuestions: ["What does follow-up mean in a digital record?", "Should the next visit overwrite the previous visit?", "How does follow-up support continuity?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "multiple-chambers",
    title: "Managing Multiple Chambers in One Clinical Workspace",
    question: "How can one doctor keep multiple chambers organized in a single workspace?",
    description: "How Doctor's Diary keeps practice-location context available without mixing it with patient ownership.",
    directAnswer: "A multi-chamber workspace should let one doctor maintain practice-location context without fragmenting the doctor's clinical records. Doctor's Diary is designed to associate chamber information with the relevant workflow while keeping the doctor as the central professional identity. Location context can support scheduling, profile and consultation operations, but it should not become a shortcut for exposing another doctor's records or changing who owns patient data.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "One professional identity, several locations", paragraphs: ["Chambers are practice locations associated with the doctor rather than separate copies of the doctor's identity."] },
      { heading: "Keep permissions explicit", paragraphs: ["Location context can influence operational access, but authorization boundaries still need explicit roles and data controls."] },
    ],
    relatedQuestions: ["Can one doctor use Doctor's Diary in more than one chamber?", "Does chamber access change patient ownership?", "How does a public profile show chambers?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "doctor-owned-patient-data",
    title: "Doctor-Owned Patient Data: What It Means in Doctor's Diary",
    question: "What does doctor-controlled patient data mean in Doctor's Diary?",
    description: "A product explanation of Doctor's Diary's isolation, export and non-merging principles.",
    directAnswer: "In Doctor's Diary, doctor-controlled patient data means one doctor's clinical records are not treated as a shared pool for unrelated doctors. The product policy is to keep professional and patient records isolated by authorized context, never sell or merge patient data for commercial aggregation, and support doctor export. Public doctor-profile information is a separate surface from private clinical records and does not make those records searchable or public.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Isolation is the default", paragraphs: ["Clinical records remain behind authenticated and authorized application boundaries. A public profile is not a window into a doctor's patient records."] },
      { heading: "Public presence is separate", paragraphs: ["Search eligibility applies only to approved public professional information. It does not turn private application data into public content."] },
    ],
    relatedQuestions: ["Are patient records included in a doctor's public profile?", "Can another doctor automatically see my records?", "Can a doctor export data?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "safe-ai-assisted-clinical-workflow",
    title: "Safe AI-Assisted Clinical Workflow: Propose, Review, Apply",
    question: "How can AI assist a clinical workflow without taking over the doctor's decision?",
    description: "Doctor's Diary's proposal-before-apply model for voice and AI-assisted workflow actions.",
    directAnswer: "Doctor's Diary treats AI assistance as a proposal layer, not an autonomous clinical authority. Voice or command features can help capture text, navigate or prepare a proposed change, but the doctor should be able to review, edit or discard it before an explicit Apply or Accept action. Ambiguous medicine or dose information should not be silently resolved, and an AI command must not finalize a prescription. Final clinical actions remain doctor-controlled and auditable.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Proposal before write", paragraphs: ["An assistant can prepare a proposed action while leaving the underlying record unchanged until the user explicitly accepts it."] },
      { heading: "Ambiguity should fail safely", paragraphs: ["When a command is incomplete or ambiguous, the safe behavior is to ask for clarification or withhold the write rather than invent missing medicine or dose details."] },
      { heading: "Finalization is prohibited", paragraphs: ["The voice-command layer is not authorized to turn a draft into a finalized prescription. That boundary protects the doctor's final review step."] },
    ],
    relatedQuestions: ["Can voice commands finalize a prescription?", "What happens when medicine information is ambiguous?", "Can a doctor edit an AI proposal before applying it?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "patients",
    slug: "public-doctor-profile-and-booking",
    title: "Public Doctor Profiles and Online Booking in Doctor's Diary",
    question: "How do public doctor profiles and booking work in Doctor's Diary?",
    description: "A product explanation of the public profile and booking surface, separate from private clinical records.",
    directAnswer: "Doctor's Diary can give a doctor an opt-in public professional profile with approved professional and chamber information and a booking path. Patients can use that public surface without receiving access to the doctor's private application or clinical records. Search indexing is separately gated: a profile must meet the product's publication, account, classification and completeness rules before it can be eligible for search discovery.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Public information is intentionally limited", paragraphs: ["The public page is for professional identity and booking context. It does not expose patient records or authenticated application data."] },
      { heading: "Publication and search are different gates", paragraphs: ["A profile can have a public-product state while search eligibility remains fail-closed until the search-indexing contract is satisfied."] },
    ],
    relatedQuestions: ["What can patients see on a public doctor profile?", "Does booking expose medical records?", "Why might a public profile not appear in search?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "medical-students",
    slug: "prescription-structure",
    title: "Prescription Structure for Medical Students",
    question: "What does prescription structure mean in a digital clinical workflow?",
    description: "A workflow-focused introduction to prescription record structure without teaching treatment choices or dosing.",
    directAnswer: "In a digital workflow, prescription structure means organizing the record so patient and encounter context, prescribed items, associated instructions, follow-up information and prescriber identity remain understandable and reviewable. Doctor's Diary separates drafting from finalization so the record can be reviewed before it becomes final. This page explains documentation structure only; it does not teach which medicine, dose or treatment should be chosen.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Think in record sections", paragraphs: ["A structured prescription record separates identifying context from the editable prescription draft and from the act of finalization."] },
      { heading: "Do not confuse structure with clinical choice", paragraphs: ["Documentation software can organize information, but medicine selection and dosing are clinical decisions outside the scope of this educational workflow page."] },
    ],
    relatedQuestions: ["What is a prescription draft?", "Why is finalization separate?", "How are corrections handled after finalization?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "medical-students",
    slug: "consultation-documentation",
    title: "Clinical Consultation Documentation for Medical Students",
    question: "How should a digital consultation record preserve the structure of an encounter?",
    description: "A documentation-oriented explanation of current-encounter notes, history, investigations and follow-up context.",
    directAnswer: "A digital consultation record should make it clear what belongs to today's encounter, what comes from earlier history, and what is planned for follow-up. Doctor's Diary is structured around that separation: previous records provide context, current notes belong to the active encounter, and related investigations, prescription work and follow-up remain connected to the patient timeline. The goal is traceable documentation, not automated diagnosis or treatment advice.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Preserve chronology", paragraphs: ["Documentation becomes more reliable when each encounter remains historically distinct and earlier records are treated as context."] },
      { heading: "Connect related workflow records", paragraphs: ["Investigations, prescription preparation and follow-up can be connected to the patient timeline while retaining their own workflow boundaries."] },
    ],
    relatedQuestions: ["What belongs to the current encounter?", "How should previous history be shown?", "Why is follow-up linked to an encounter?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "medical-students",
    slug: "rbac-and-audit-trails",
    title: "Why Clinical Records Need Role-Based Access and Audit Trails",
    question: "Why do role boundaries and audit trails matter in clinical software?",
    description: "A software-governance explanation of least-privilege roles, isolation and traceable actions.",
    directAnswer: "Role-based access control limits each user to the information and actions appropriate to that role, while audit trails create a traceable record of important system activity. In Doctor's Diary, a receptionist, doctor, location administrator and platform owner do not receive the same clinical authority. Database policies and server-side authorization remain the real security boundaries; interface visibility alone is not treated as sufficient protection.",
    contentClass: "PROFESSIONAL_WORKFLOW",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Use least privilege", paragraphs: ["Operational roles can support scheduling or administration without inheriting unrestricted clinical-record access."] },
      { heading: "Make sensitive actions traceable", paragraphs: ["Auditability helps show when important actions occurred and supports investigation without making the UI the only security control."] },
    ],
    relatedQuestions: ["Why is hiding a button not enough for security?", "What does least privilege mean?", "Why keep an audit trail?"],
    references: PRODUCT_REFS,
  },
  {
    audience: "doctors",
    slug: "product-privacy-editorial-responsibility",
    title: "Doctor's Diary by AgentSiraji: Product, Privacy and Editorial Responsibility",
    question: "How does Doctor's Diary separate product documentation, private clinical data and public educational content?",
    description: "The public-source boundaries behind Doctor's Diary product pages, private application data and reviewed educational content.",
    directAnswer: "Doctor's Diary separates three responsibilities: the product workspace holds authenticated clinical and practice data; public product documentation explains how the software works; and educational content follows an editorial classification and review policy. Public search content must never be generated from private patient records. Clinical or patient-facing claims require the review level defined by the medical-content policy, and AI-generated material is not automatically approved for publication.",
    contentClass: "PRODUCT",
    hasClinicalClaims: false,
    authorSlug: "agentsiraji",
    datePublished: "2026-09-20",
    dateReviewed: "2026-09-20",
    editorialApproval: "PENDING_CENTRAL",
    sections: [
      { heading: "Keep product and clinical education distinct", paragraphs: ["A product page may explain features and security behavior. Clinical education has a different evidence and reviewer requirement."] },
      { heading: "Private data is not source material", paragraphs: ["Patient records and authenticated application data are excluded from the public-content pipeline and from public sitemaps."] },
      { heading: "Human approval remains required", paragraphs: ["AI can assist drafting, but it does not create publication authority. Editorial approval is an explicit gate."] },
    ],
    relatedQuestions: ["Who approves Doctor's Diary content?", "Can patient data be used as public content?", "What content requires a clinician reviewer?"],
    references: PRODUCT_REFS,
  },
];

export const GATED_PATIENT_CLINICAL_BACKLOG = [
  {
    title: "How to Prepare for a Doctor Appointment",
    audience: "patients" as const,
    contentClass: "PATIENT_CLINICAL" as const,
    gate: "Verified clinician reviewer and authoritative evidence required before public article creation.",
  },
  {
    title: "How Patients Can Keep Prescriptions and Investigation Reports Organized",
    audience: "patients" as const,
    contentClass: "PATIENT_CLINICAL" as const,
    gate: "Verified clinician reviewer and authoritative evidence required before public article creation.",
  },
] as const;

export function getAuthor(slug: string): PublicAuthor | undefined {
  return PUBLIC_AUTHORS.find((author) => author.slug === slug);
}

export function getReviewer(slug: string | undefined): PublicReviewer | undefined {
  if (!slug) return undefined;
  return PUBLIC_REVIEWERS.find((reviewer) => reviewer.slug === slug);
}

export function isVerifiedReviewer(reviewer: PublicReviewer | undefined): boolean {
  return Boolean(
    reviewer?.identityVerified && reviewer.credentialsVerified && reviewer.consentObtained,
  );
}

export function isGovernanceEligible(article: KnowledgeArticle): boolean {
  if (!getAuthor(article.authorSlug)) return false;
  if (article.contentClass === "PRODUCT") return !article.hasClinicalClaims;
  if (article.contentClass === "PROFESSIONAL_WORKFLOW") {
    return !article.hasClinicalClaims || isVerifiedReviewer(getReviewer(article.reviewerSlug));
  }
  return (
    isVerifiedReviewer(getReviewer(article.reviewerSlug)) &&
    article.references.some((reference) => reference.sourceType === "AUTHORITATIVE_EVIDENCE")
  );
}

export function isProductionPublishable(article: KnowledgeArticle): boolean {
  return article.editorialApproval === "APPROVED" && isGovernanceEligible(article);
}

export function isPreviewReviewable(article: KnowledgeArticle): boolean {
  return isGovernanceEligible(article);
}

export function articlePath(article: KnowledgeArticle): string {
  return `/learn/${article.audience}/${article.slug}`;
}

export function getKnowledgeArticles(options?: { productionOnly?: boolean }): KnowledgeArticle[] {
  const productionOnly = options?.productionOnly ?? process.env.VERCEL_ENV === "production";
  return articles.filter((article) =>
    productionOnly ? isProductionPublishable(article) : isPreviewReviewable(article),
  );
}

export function getKnowledgeArticle(
  audience: string,
  slug: string,
  options?: { productionOnly?: boolean },
): KnowledgeArticle | undefined {
  return getKnowledgeArticles(options).find(
    (article) => article.audience === audience && article.slug === slug,
  );
}

export function getArticlesForAudience(
  audience: KnowledgeAudience,
  options?: { productionOnly?: boolean },
): KnowledgeArticle[] {
  return getKnowledgeArticles(options).filter((article) => article.audience === audience);
}

export function getKnowledgeSitemapPaths(): string[] {
  return getKnowledgeArticles().map(articlePath);
}
