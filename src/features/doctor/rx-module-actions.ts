"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import {
  rxModulesPayloadSchema,
  withPositions,
  type RxModule,
  type RxModuleSetting,
} from "./rx-modules";

/**
 * Reading and writing the doctor's prescription sections.
 *
 * Both go through RPCs that resolve the doctor from `auth.uid()`. NOTHING HERE
 * ACCEPTS A DOCTOR ID — a caller-supplied identity on a write is how one doctor
 * edits another, and the database already knows who is asking.
 *
 * This is layout, not clinical content: it changes what FUTURE prescriptions
 * contain and can never change one already finalised, which carries its own
 * frozen copy of these settings.
 */

export type RxModulesResult = { ok: true } | { ok: false; message: string };

export type RxModulesRead =
  | { ok: true; modules: RxModuleSetting[] }
  /**
   * A failed read is NOT "no configuration". Showing the defaults after a
   * broken query would invite a doctor to save them over settings they already
   * have.
   */
  | { ok: false };

export async function getRxModulesAction(): Promise<RxModulesRead> {
  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("doctor_rx_modules");
  if (error || !Array.isArray(data)) {
    if (error) console.error("[doctor] rx modules read failed", error.message);
    return { ok: false };
  }

  /**
   * The database already resolved defaults for anything untouched and returned
   * the rows in the doctor's order. Kept in that order — re-sorting here would
   * be the UI deciding an arrangement the doctor did not choose.
   */
  return {
    ok: true,
    modules: data.map((row: Record<string, unknown>) => ({
      module: row.module as RxModule,
      useDuringConsultation: Boolean(row.use_during_consultation),
      showOnPrint: Boolean(row.show_on_print),
      printLabel: (row.print_label as string | null) ?? null,
    })),
  };
}

export async function saveRxModulesAction(input: unknown): Promise<RxModulesResult> {
  const parsed = rxModulesPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Those settings could not be saved. Reload and try again." };
  }

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  // ONE write for the whole screen — see `save_rx_modules`. Position is derived
  // from the order here, never sent up from the browser.
  const { error } = await supabase.rpc("save_rx_modules", {
    p_modules: withPositions(parsed.data),
  });

  if (error) return { ok: false, message: saveError(error.message) };

  revalidatePath("/settings/prescription/sections");
  revalidatePath("/settings/prescription");
  return { ok: true };
}

/**
 * The database's refusals, said in a sentence.
 *
 * The rules live in `save_rx_modules` and are re-checked here only so the
 * doctor is told at the keyboard. This turns the SQLSTATE into English; it is
 * not a second, weaker copy of the rule.
 */
function saveError(message: string): string {
  if (/LABEL_TOO_LONG/.test(message)) {
    return "One of your headings is too long. Keep each to 40 characters or fewer.";
  }
  if (/LABEL_INVALID/.test(message)) {
    return 'A heading cannot contain < > & or " — headings are printed as plain text.';
  }
  if (/only a doctor has a prescription layout/.test(message)) {
    return "Only a doctor can set this up. Fill in your doctor details first.";
  }
  console.error("[doctor] rx modules save failed", message);
  return "Those settings could not be saved. Try again in a moment.";
}
