import { z } from "zod";

/**
 * Validation for practice-location forms.
 *
 * Deliberately NOT in actions.ts: that file carries "use server", and a
 * "use server" module may export ONLY async functions. Exporting a Zod object
 * from it throws at runtime — "A use server file can only export async
 * functions, found object" — when the action is invoked. The page still renders
 * fine, so lint, typecheck and `next build` all pass and only the form submit
 * breaks.
 */
export const addLocationSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(160),
  type: z.enum([
    "PERSONAL_CHAMBER",
    "CLINIC",
    "HOSPITAL",
    "TELEMEDICINE",
    "OTHER",
  ]),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  district: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  makeActive: z.coerce.boolean().optional(),
});

export type AddLocationInput = z.infer<typeof addLocationSchema>;
