import {
  pgTable,
  pgSchema,
  pgEnum,
  uuid,
  text,
  date,
  numeric,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Identity, practice locations, membership, audit.
 *
 * TENANCY — FINAL (see docs/architecture.md §2). Two orthogonal questions:
 *
 *   owner_doctor_id       "whose patient is this?"
 *   practice_location_id  "where did this event happen?"
 *
 * Doctor's Diary is a DOCTOR-OWNED personal clinical repository, not a
 * clinic-owned EMR:
 *   • each doctor has a completely separate patient repository
 *   • the same human seen by two doctors is TWO records, never merged
 *   • within one doctor's repository, visits at a hospital, a clinic and a
 *     personal chamber form ONE continuous timeline
 *   • staff access is scoped to a practice location
 *
 * Every clinical event table added in later phases MUST carry
 * `practice_location_id`.
 */

/** Supabase's auth.users, declared so we can foreign-key to it. Never written to. */
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const locationRole = pgEnum("location_role", [
  "DOCTOR",
  "RECEPTIONIST",
  "LOCATION_ADMIN",
]);

export const memberStatus = pgEnum("member_status", [
  "INVITED",
  "ACTIVE",
  "SUSPENDED",
]);

/**
 * A doctor may practise in any of these. Naming this `clinic_type` would have
 * forced hospitals and chambers to masquerade as clinics — the reason for the
 * rename before patient tables exist.
 */
export const locationType = pgEnum("location_type", [
  "PERSONAL_CHAMBER",
  "CLINIC",
  "HOSPITAL",
  "TELEMEDICINE",
  "OTHER",
]);

/** One row per authenticated human. Mirrors auth.users. */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("en"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The doctor identity. This is what owns patients (Phase 3), which is why it is
 * separate from clinic membership — a doctor keeps their patient list when they
 * change clinics.
 */
export const doctorProfiles = pgTable(
  "doctor_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    qualification: text("qualification"),
    specialization: text("specialization"),
    /** Bangladesh Medical & Dental Council registration. */
    bmdcRegistrationNo: text("bmdc_registration_no"),
    signatureUrl: text("signature_url"),
    /** Prefix for this doctor's own patient numbering, e.g. "AR" -> AR-000124. */
    patientNumberPrefix: text("patient_number_prefix").notNull().default("PT"),
    patientNumberSeq: integer("patient_number_seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("doctor_profiles_user_id_key").on(t.userId)],
);

export const practiceLocations = pgTable(
  "practice_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: locationType("type").notNull().default("PERSONAL_CHAMBER"),
    address: text("address"),
    district: text("district"),
    phone: text("phone"),
    logoUrl: text("logo_url"),
    timezone: text("timezone").notNull().default("Asia/Dhaka"),
    settings: jsonb("settings").notNull().default({}),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("practice_locations_created_by_idx").on(t.createdBy)],
);

/**
 * THE authorization join. Every RLS policy resolves through this table:
 * "is the current user an ACTIVE member of the clinic that owns this row?"
 */
export const practiceLocationMembers = pgTable(
  "practice_location_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: locationRole("role").notNull(),
    status: memberStatus("status").notNull().default("ACTIVE"),
    invitedBy: uuid("invited_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * A user may hold SEVERAL roles at one location — one row per role.
     *
     * Not incidental: a doctor running their own chamber is both the DOCTOR
     * (writes clinical records) and the LOCATION_ADMIN (manages settings and
     * staff). Forcing a single role would leave a solo practitioner unable to
     * do half their job. Permission checks take the union — see canAny().
     */
    uniqueIndex("practice_location_members_location_user_role_key").on(
      t.practiceLocationId,
      t.userId,
      t.role,
    ),
    index("practice_location_members_user_idx").on(t.userId),
    index("practice_location_members_location_idx").on(t.practiceLocationId),
  ],
);

/**
 * Append-only. There is no UPDATE or DELETE grant on this table for anyone,
 * including clinic admins — see supabase/policies.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceLocationId: uuid("practice_location_id").references(
      () => practiceLocations.id,
      { onDelete: "set null" },
    ),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_events_location_occurred_idx").on(
      t.practiceLocationId,
      t.occurredAt,
    ),
    index("audit_events_actor_idx").on(t.actorId),
  ],
);

// =============================================================================
// PATIENTS — Phase 3
//
// OWNERSHIP: `owner_doctor_id` is the boundary. Each doctor has a completely
// separate repository; the same human seen by two doctors is two records, never
// merged. Deduplication operates only within one owner_doctor_id. (ADR 0001/0002)
// =============================================================================

export const sex = pgEnum("sex", ["MALE", "FEMALE", "OTHER", "UNKNOWN"]);

/**
 * Many patients do not know an exact birth date. Storing a fabricated
 * 1970-01-01 silently corrupts every age- and weight-based dose calculation
 * downstream, so precision is recorded explicitly.
 */
export const dobPrecision = pgEnum("dob_precision", [
  "DAY",
  "MONTH",
  "YEAR",
  "AGE_ONLY",
]);

export const bloodGroup = pgEnum("blood_group", [
  "A_POS", "A_NEG", "B_POS", "B_NEG",
  "AB_POS", "AB_NEG", "O_POS", "O_NEG", "UNKNOWN",
]);

export const allergySeverity = pgEnum("allergy_severity", [
  "MILD",
  "MODERATE",
  "SEVERE",
  "LIFE_THREATENING",
]);

export const conditionStatus = pgEnum("condition_status", [
  "ACTIVE",
  "RESOLVED",
  "SUSPECTED",
]);

export const medicationSource = pgEnum("medication_source", [
  "REPORTED",
  "PRESCRIBED",
]);

export const alertSeverity = pgEnum("alert_severity", [
  "INFO",
  "CAUTION",
  "SERIOUS",
  "CRITICAL",
]);

export const contactType = pgEnum("contact_type", [
  "EMERGENCY",
  "GUARDIAN",
  "OTHER",
]);

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** THE ownership boundary. Every policy and query starts here. */
    ownerDoctorId: uuid("owner_doctor_id")
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: "restrict" }),

    /**
     * Future link to a public booking account (ADR 0002). Nullable, and normal
     * to be null — most patients are walk-ins the doctor typed in.
     *
     * MUST NEVER appear in a clinical RLS predicate. Joining authorization on
     * this is exactly how one doctor's records become reachable from another's.
     */
    patientAccountId: uuid("patient_account_id"),

    /** Human-friendly, per-doctor. Allocated atomically — see next_patient_number(). */
    patientNumber: text("patient_number").notNull(),

    fullName: text("full_name").notNull(),
    /** Lowercased, punctuation-stripped, whitespace-collapsed. Search + dedupe. */
    nameNormalized: text("name_normalized").notNull(),

    dob: date("dob"),
    dobPrecision: dobPrecision("dob_precision").notNull().default("DAY"),
    /** Used when precision is AGE_ONLY; aged forward from ageRecordedOn. */
    approxAgeYears: integer("approx_age_years"),
    ageRecordedOn: date("age_recorded_on"),

    sex: sex("sex").notNull().default("UNKNOWN"),
    phone: text("phone"),
    /** Digits-only normalised form. Strongest duplicate signal. */
    phoneNormalized: text("phone_normalized"),
    email: text("email"),
    address: text("address"),
    district: text("district"),

    bloodGroup: bloodGroup("blood_group").notNull().default("UNKNOWN"),
    heightCm: numeric("height_cm"),
    weightKg: numeric("weight_kg"),

    notes: text("notes"),
    isDeceased: boolean("is_deceased").notNull().default(false),

    /** Future in-repository merge. Never used across doctors. */
    mergedIntoId: uuid("merged_into_id"),

    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete only — a clinical record is never destroyed. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("patients_owner_number_key").on(t.ownerDoctorId, t.patientNumber),
    index("patients_owner_idx").on(t.ownerDoctorId),
    index("patients_owner_phone_idx").on(t.ownerDoctorId, t.phoneNormalized),
    index("patients_owner_name_idx").on(t.ownerDoctorId, t.nameNormalized),
    index("patients_account_idx").on(t.patientAccountId),
  ],
);

/**
 * Which practice locations a patient has been seen at.
 *
 * This is what makes staff access scopeable without leaking a doctor's private
 * chamber. The owning doctor sees every patient they own; a receptionist sees
 * only patients linked to a location where they are an active member.
 *
 * Without it, staff access would be all-or-nothing: either reception cannot
 * find a patient to book them, or reception at a hospital can see the names of
 * everyone the doctor treats privately.
 */
export const patientLocationLinks = pgTable(
  "patient_location_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("patient_location_links_key").on(t.patientId, t.practiceLocationId),
    index("patient_location_links_location_idx").on(t.practiceLocationId),
  ],
);

export const patientContacts = pgTable(
  "patient_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    type: contactType("type").notNull().default("EMERGENCY"),
    name: text("name").notNull(),
    phone: text("phone"),
    relationship: text("relationship"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_contacts_patient_idx").on(t.patientId)],
);

/** Safety-critical. Surfaced in the patient safety header on every screen. */
export const patientAllergies = pgTable(
  "patient_allergies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    substance: text("substance").notNull(),
    reaction: text("reaction"),
    severity: allergySeverity("severity").notNull().default("MODERATE"),
    onsetDate: date("onset_date"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_allergies_patient_idx").on(t.patientId)],
);

export const patientConditions = pgTable(
  "patient_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    condition: text("condition").notNull(),
    icd10Code: text("icd10_code"),
    status: conditionStatus("status").notNull().default("ACTIVE"),
    onsetDate: date("onset_date"),
    resolvedDate: date("resolved_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_conditions_patient_idx").on(t.patientId)],
);

export const patientMedications = pgTable(
  "patient_medications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dose: text("dose"),
    frequency: text("frequency"),
    /** REPORTED = what the patient says they take. Not a prescription. */
    source: medicationSource("source").notNull().default("REPORTED"),
    startedOn: date("started_on"),
    stoppedOn: date("stopped_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_medications_patient_idx").on(t.patientId)],
);

export const patientAlerts = pgTable(
  "patient_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    severity: alertSeverity("severity").notNull().default("CAUTION"),
    message: text("message").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_alerts_patient_idx").on(t.patientId)],
);

export type Profile = typeof profiles.$inferSelect;
export type DoctorProfile = typeof doctorProfiles.$inferSelect;
export type PracticeLocation = typeof practiceLocations.$inferSelect;
export type PracticeLocationMember = typeof practiceLocationMembers.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type PatientAllergy = typeof patientAllergies.$inferSelect;
export type PatientCondition = typeof patientConditions.$inferSelect;
export type PatientMedication = typeof patientMedications.$inferSelect;
export type PatientAlert = typeof patientAlerts.$inferSelect;
export type PatientContact = typeof patientContacts.$inferSelect;
