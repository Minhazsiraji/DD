import {
  pgTable,
  pgSchema,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Phase 2 schema — identity, clinics, membership, audit.
 *
 * TENANCY (hybrid — see docs/architecture.md §2):
 *   • patient IDENTITY is doctor-owned  → one timeline across clinics
 *   • every clinical EVENT carries clinic_id → clinic-scoped access
 *
 * Phase 2 introduces only the identity and membership half. The event tables
 * (appointments, encounters, prescriptions …) arrive in later phases and every
 * one of them MUST carry `clinic_id`.
 */

/** Supabase's auth.users, declared so we can foreign-key to it. Never written to. */
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const clinicRole = pgEnum("clinic_role", [
  "DOCTOR",
  "RECEPTIONIST",
  "CLINIC_ADMIN",
]);

export const memberStatus = pgEnum("member_status", [
  "INVITED",
  "ACTIVE",
  "SUSPENDED",
]);

export const clinicType = pgEnum("clinic_type", [
  "OWN_CHAMBER",
  "CLINIC",
  "HOSPITAL",
  "TELEMEDICINE",
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

export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: clinicType("type").notNull().default("OWN_CHAMBER"),
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
  (t) => [index("clinics_created_by_idx").on(t.createdBy)],
);

/**
 * THE authorization join. Every RLS policy resolves through this table:
 * "is the current user an ACTIVE member of the clinic that owns this row?"
 */
export const clinicMembers = pgTable(
  "clinic_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: clinicRole("role").notNull(),
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
     * A user may hold SEVERAL roles at one clinic — one row per role.
     *
     * This is not incidental: a doctor running their own chamber is both the
     * DOCTOR (writes clinical records) and the CLINIC_ADMIN (manages settings
     * and staff). Forcing a single role would leave a solo practitioner unable
     * to do half their job. Permission checks therefore take the union of the
     * user's roles at the active clinic — see canAny().
     */
    uniqueIndex("clinic_members_clinic_user_role_key").on(
      t.clinicId,
      t.userId,
      t.role,
    ),
    index("clinic_members_user_idx").on(t.userId),
    index("clinic_members_clinic_idx").on(t.clinicId),
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
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "set null",
    }),
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
    index("audit_events_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("audit_events_actor_idx").on(t.actorId),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type DoctorProfile = typeof doctorProfiles.$inferSelect;
export type Clinic = typeof clinics.$inferSelect;
export type ClinicMember = typeof clinicMembers.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
