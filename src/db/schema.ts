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
  primaryKey,
  bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    /** e.g. "Associate Professor", "Consultant". Prints under the name. */
    designation: text("designation"),
    /**
     * Bangladesh Medical & Dental Council registration.
     *
     * SELF-ASSERTED and unverified (ADR 0003). Safe on the doctor's own
     * prescription; must never be rendered publicly as a verified credential.
     */
    bmdcRegistrationNo: text("bmdc_registration_no"),
    /** Storage path in the private `doctor-assets` bucket, not a public URL. */
    signatureUrl: text("signature_url"),
    /** Prefix for this doctor's own patient numbering, e.g. "AR" -> AR-000124. */
    patientNumberPrefix: text("patient_number_prefix").notNull().default("PT"),
    patientNumberSeq: integer("patient_number_seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("doctor_profiles_user_id_key").on(t.userId)],
);

export const paperSize = pgEnum("paper_size", ["A4", "A5"]);

/**
 * How a doctor's prescription looks — header, footer and paper.
 *
 * Configured ONCE and then reused, which is the point: a doctor's prescription
 * is part of their professional identity, and software that reformats it is
 * software they resent. This holds the layout only; the prescription contents
 * are a later phase.
 *
 * A template may be scoped to one practice location (a hospital pad differs
 * from a private chamber pad) or apply everywhere when practice_location_id is
 * null. Exactly one default per (doctor, location).
 */
export const prescriptionTemplates = pgTable(
  "prescription_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerDoctorId: uuid("owner_doctor_id")
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: "cascade" }),
    /** Null = applies at every location this doctor practises in. */
    practiceLocationId: uuid("practice_location_id").references(
      () => practiceLocations.id,
      { onDelete: "cascade" },
    ),

    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),

    paperSize: paperSize("paper_size").notNull().default("A4"),
    marginMm: integer("margin_mm").notNull().default(15),
    baseFontPt: integer("base_font_pt").notNull().default(11),

    /**
     * Many chambers print on pre-printed letterhead. Rendering our own header
     * on top of that produces a duplicated, unusable prescription — so the
     * header must be switchable off entirely, not merely restyled.
     */
    showHeader: boolean("show_header").notNull().default(true),
    showClinicLogo: boolean("show_clinic_logo").notNull().default(false),
    /** Overrides the location name on the printed header when set. */
    clinicNameOverride: text("clinic_name_override"),
    headerNote: text("header_note"),

    showQualification: boolean("show_qualification").notNull().default(true),
    showSpecialization: boolean("show_specialization").notNull().default(true),
    showDesignation: boolean("show_designation").notNull().default(true),
    showBmdc: boolean("show_bmdc").notNull().default(true),
    showChamberAddress: boolean("show_chamber_address").notNull().default(true),
    showChamberPhone: boolean("show_chamber_phone").notNull().default(true),

    showFooter: boolean("show_footer").notNull().default(true),
    footerText: text("footer_text"),
    showSignature: boolean("show_signature").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prescription_templates_owner_idx").on(t.ownerDoctorId),
    index("prescription_templates_location_idx").on(t.practiceLocationId),
  ],
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

    /**
     * NOTE: free-text clinical notes are NOT here. They live in
     * patient_private_notes, which is doctor-only.
     *
     * RLS is row-level, not column-level, so any staff member allowed to see
     * the patient row could read every column on it — including a note reading
     * "suspected malignancy". Splitting the table is the only way to withhold
     * one column from a role that legitimately needs the rest of the row.
     */
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
 * Free-text clinical notes about a patient. DOCTOR ONLY.
 *
 * Separated from `patients` because Postgres RLS filters rows, not columns:
 * reception needs the patient row to book an appointment, and would otherwise
 * read this alongside it.
 */
export const patientPrivateNotes = pgTable(
  "patient_private_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    updatedBy: uuid("updated_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("patient_private_notes_patient_key").on(t.patientId)],
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

// ---------------------------------------------------------------------------
// Appointments (Stage 4)
// ---------------------------------------------------------------------------

/**
 * The appointment lifecycle.
 *
 * CANCELLED, COMPLETED and NO_SHOW are terminal. Rescheduling does NOT mutate a
 * row through some "rescheduled" state: the original is cancelled with reason
 * RESCHEDULED and a new appointment is created pointing back at it, so the
 * history of when a patient was originally due survives.
 */
export const appointmentStatus = pgEnum("appointment_status", [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_CONSULTATION",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const visitType = pgEnum("visit_type", [
  "NEW",
  "FOLLOW_UP",
  "REPORT_REVIEW",
  "PROCEDURE",
  "EMERGENCY",
]);

/**
 * Why an appointment did not happen. Recorded because "cancelled" alone cannot
 * distinguish a patient who chose not to come from a doctor who was called into
 * surgery, and the follow-up owed to the patient differs completely.
 */
export const cancellationReason = pgEnum("cancellation_reason", [
  "PATIENT_REQUEST",
  "PATIENT_UNWELL",
  "DOCTOR_UNAVAILABLE",
  "RESCHEDULED",
  "DUPLICATE",
  "OTHER",
]);

export const appointmentEventType = pgEnum("appointment_event_type", [
  "CREATED",
  "CONFIRMED",
  "RESCHEDULED",
  "ARRIVED",
  "CONSULTATION_STARTED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Whose appointment this is. The ownership boundary — see ADR 0001.
     *
     * RESTRICT, not cascade: an appointment is a record that a person was
     * expected at a place and time. Deleting a doctor or a patient must not
     * silently erase that history — deactivate them instead.
     */
    ownerDoctorId: uuid("owner_doctor_id")
      .notNull()
      .references(() => doctorProfiles.id, { onDelete: "restrict" }),
    /** Mandatory on every event table. Where this appointment happens. */
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "restrict" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),

    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),

    /**
     * The clinic day this belongs to, in the LOCATION's timezone.
     *
     * Stored rather than derived because `scheduled_for::date` uses the
     * database session's timezone: a 12:30am Dhaka appointment is still the
     * previous day in UTC, so it would be filed under the wrong session and
     * take a token from the wrong queue. Computed once, at write time, from
     * practice_locations.timezone.
     */
    sessionDate: date("session_date").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(15),
    visitType: visitType("visit_type").notNull().default("NEW"),
    status: appointmentStatus("status").notNull().default("SCHEDULED"),

    /** Why the patient is coming, in their own words. Not a diagnosis. */
    reason: text("reason"),

    /**
     * Stage 5 will build the live queue on top of this. Allocated at check-in
     * so the number reflects arrival order, not booking order.
     *
     * Uniqueness per (location, session_date) is enforced by a partial unique
     * index — see supabase/policies/0010. Allocation goes through a counter
     * row, because `max(token) + 1` is not serialised by locking the
     * appointment being checked in: two receptionists checking in two
     * DIFFERENT patients lock different rows and read the same maximum.
     */
    tokenNumber: integer("token_number"),

    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    consultationStartedAt: timestamp("consultation_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    cancellationReason: cancellationReason("cancellation_reason"),
    /** Free text, doctor/reception-visible. Never a clinical finding. */
    cancellationNote: text("cancellation_note"),

    /** Set on the NEW appointment, pointing at the one it replaced. */
    rescheduledFromId: uuid("rescheduled_from_id"),

    /** Who booked it — a receptionist is common and must stay distinguishable. */
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appointments_doctor_date_idx").on(t.ownerDoctorId, t.scheduledFor),
    index("appointments_location_session_idx").on(t.practiceLocationId, t.sessionDate),
    index("appointments_patient_idx").on(t.patientId),
    index("appointments_status_idx").on(t.status),
  ],
);

/**
 * One row per (location, clinic day), holding the last token issued.
 *
 * This exists because `select max(token_number) + 1` cannot be made safe by
 * locking the appointment being checked in — two receptionists checking in two
 * different patients take locks on different rows, both read the same maximum,
 * and both hand out token 7. Incrementing a single shared row serialises them,
 * the same trick already used for patient numbers.
 */
export const appointmentTokenCounters = pgTable(
  "appointment_token_counters",
  {
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "cascade" }),
    sessionDate: date("session_date").notNull(),
    lastToken: integer("last_token").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.practiceLocationId, t.sessionDate] })],
);

/**
 * Append-only history of everything that happened to an appointment.
 *
 * The appointment row holds current state; this holds how it got there. Kept
 * separate because "cancelled twice, rebooked, then no-showed" is a real
 * pattern, and a single mutable row cannot answer questions about it. No UPDATE
 * or DELETE policy will exist for this table, the same as audit_events.
 */
export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * RESTRICT: the history must outlive any ordinary attempt to remove the
     * appointment it describes. Cascading here would mean a single DELETE
     * erases both the fact and the evidence.
     */
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "restrict" }),
    eventType: appointmentEventType("event_type").notNull(),
    fromStatus: appointmentStatus("from_status"),
    toStatus: appointmentStatus("to_status"),
    actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
    /** Operational note only — reasons, not clinical content. */
    note: text("note"),
    /**
     * clock_timestamp(), NOT now().
     *
     * `now()` is the TRANSACTION's start time, so two racing transactions can
     * stamp history in an order that never happened — a cancellation begun a
     * millisecond earlier but committed later sorts before the arrival it
     * actually followed. Caught by the arrival+cancellation race test.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /**
     * The authoritative order. Timestamps can tie or mislead; this cannot.
     * Rows are inserted under the appointment's row lock, so sequence order is
     * the real order of events.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (t) => [
    index("appointment_events_appointment_idx").on(t.appointmentId),
    index("appointment_events_location_idx").on(t.practiceLocationId),
    index("appointment_events_seq_idx").on(t.appointmentId, t.seq),
  ],
);

// ---------------------------------------------------------------------------
// Live queue (Stage 5)
// ---------------------------------------------------------------------------

/**
 * Why someone was moved up the queue.
 *
 * Required whenever priority is set. A queue that lets people jump without
 * recording why is a queue that will eventually be accused of selling the
 * privilege — and the assistant who did it will have no way to show otherwise.
 */
export const priorityReason = pgEnum("priority_reason", [
  "EMERGENCY",
  "ELDERLY",
  "CHILD",
  "PREGNANT",
  "DISABILITY",
  "UNWELL_WAITING",
  "DOCTOR_INSTRUCTION",
  "STAFF_OR_FAMILY",
  "OTHER",
]);

/**
 * The extra facts a queue needs that an appointment does not carry.
 *
 * Deliberately NOT a second lifecycle (ADR 0009). There is no status column
 * here: whether a patient is waiting, with the doctor or finished is answered by
 * `appointments.status` and nothing else, so the two can never disagree.
 *
 * Rows are created lazily — the first time someone is called, skipped or
 * prioritised — so arriving stays a single write.
 */
export const queueEntries = pgTable(
  "queue_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** One row per appointment. RESTRICT: the queue history outlives the day. */
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    /** Denormalised for the queue's hot query; never used for authorisation. */
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "restrict" }),
    sessionDate: date("session_date").notNull(),

    /**
     * An announcement, not a state change. A patient can be called three times
     * and still be outside — which is exactly why call_count exists separately
     * from anything in the appointment.
     */
    calledAt: timestamp("called_at", { withTimezone: true }),
    callCount: integer("call_count").notNull().default(0),

    /**
     * They did not answer. Still ARRIVED and still owed a consultation — they
     * have simply left the front of the line until someone recalls them.
     */
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skipCount: integer("skip_count").notNull().default(0),

    /** Higher goes first. 0 is the ordinary queue. */
    priority: integer("priority").notNull().default(0),
    priorityReason: priorityReason("priority_reason"),
    priorityNote: text("priority_note"),
    prioritySetBy: uuid("priority_set_by").references(() => profiles.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("queue_entries_appointment_key").on(t.appointmentId),
    index("queue_entries_session_idx").on(t.practiceLocationId, t.sessionDate),
  ],
);

/**
 * Append-only record of queue actions.
 *
 * Separate from appointment_events because these are not lifecycle changes:
 * "called serial 12 for the third time" says nothing about whether the patient
 * has been seen. Mixing them would make the appointment's history unreadable.
 */
export const queueEventType = pgEnum("queue_event_type", [
  "CALLED",
  "SKIPPED",
  "RECALLED",
  "PRIORITY_SET",
  "PRIORITY_CLEARED",
]);

export const queueEvents = pgTable(
  "queue_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    practiceLocationId: uuid("practice_location_id")
      .notNull()
      .references(() => practiceLocations.id, { onDelete: "restrict" }),
    eventType: queueEventType("event_type").notNull(),
    reason: priorityReason("reason"),
    note: text("note"),
    actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /** Authoritative order — see the appointment_events comment for why. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (t) => [index("queue_events_appointment_idx").on(t.appointmentId, t.seq)],
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
export type PatientPrivateNote = typeof patientPrivateNotes.$inferSelect;
export type PrescriptionTemplate = typeof prescriptionTemplates.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentEvent = typeof appointmentEvents.$inferSelect;
export type AppointmentTokenCounter = typeof appointmentTokenCounters.$inferSelect;
export type QueueEntry = typeof queueEntries.$inferSelect;
export type QueueEvent = typeof queueEvents.$inferSelect;


