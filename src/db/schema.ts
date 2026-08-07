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

export type Profile = typeof profiles.$inferSelect;
export type DoctorProfile = typeof doctorProfiles.$inferSelect;
export type PracticeLocation = typeof practiceLocations.$inferSelect;
export type PracticeLocationMember = typeof practiceLocationMembers.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
