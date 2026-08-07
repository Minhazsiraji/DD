import { z } from "zod";

/**
 * Validation runs on the SERVER, in the Server Action. Client-side validation
 * is a convenience for the user, never a control — the browser can always skip it.
 */

const email = z.email("Enter a valid email address").trim().toLowerCase();

/**
 * 10 characters rather than the more common 8. This is a healthcare system, and
 * length is the single most effective password control. Composition rules
 * (a symbol, a digit…) mostly push people toward "Password1!" and are omitted
 * deliberately.
 */
const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That password is too long");

export const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(120, "That name is too long"),
  email,
  password,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
  /** Ticked on a clinic or hospital machine — shortens the idle lock. */
  sharedDevice: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const onboardingSchema = z.object({
  qualification: z.string().trim().max(200).optional().or(z.literal("")),
  specialization: z.string().trim().max(200).optional().or(z.literal("")),
  bmdcRegistrationNo: z.string().trim().max(60).optional().or(z.literal("")),
  locationName: z
    .string()
    .trim()
    .min(2, "Enter a name for your chamber or clinic")
    .max(160),
  locationType: z.enum(["PERSONAL_CHAMBER", "CLINIC", "HOSPITAL", "TELEMEDICINE", "OTHER"]),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  district: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;

/** Shape returned by every auth Server Action. */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export const emptyState: ActionState = { ok: false };



