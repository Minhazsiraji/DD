"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { translateSaveError } from "./errors";
import { getServerState, type ServerState } from "./queries";
import {
  CONFLICT_UNLOADABLE_MESSAGE,
  WRITE_UNCONFIRMED_MESSAGE,
} from "./version-contract";
import {
  parseConfirmationRpcRow,
  parseInvestigationConfirmationInput,
} from "./investigation-v1-contract";

export type InvestigationConfirmationResult =
  | {
      ok: true;
      operationKey: string;
      confirmationVersion: number;
      confirmedCount: number;
      replayed: boolean;
      /** Database truth re-read after the mutation/replay. */
      server: ServerState;
    }
  | {
      ok: false;
      kind: "conflict";
      operationKey: string;
      message: string;
      server: ServerState;
    }
  | {
      ok: false;
      kind: "write-unconfirmed";
      operationKey: string;
      message: string;
    }
  | {
      ok: false;
      kind: "conflict-unloadable";
      operationKey: string;
      message: string;
    }
  | {
      ok: false;
      kind: "error";
      operationKey?: string;
      message: string;
    };

const UNKNOWN_CONFIRMATION_MESSAGE =
  `${WRITE_UNCONFIRMED_MESSAGE} Retry only with the same confirmation operation.`;

/**
 * Confirm the complete locally staged Investigation V1 list in one authoritative
 * database operation.
 *
 * The active location is resolved from verified server session context and the
 * Doctor identity is deliberately NOT an input. Database authority repeats the
 * Doctor/location/AAL2/CAS checks before any clinical write.
 */
export async function confirmInvestigationsAction(
  input: unknown,
): Promise<InvestigationConfirmationResult> {
  const parsed = parseInvestigationConfirmationInput(input);
  if (!parsed.ok) {
    return { ok: false, kind: "error", message: parsed.message };
  }

  const { encounterId, expectedVersion, operationKey, investigations } = parsed.value;
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  let rpcData: unknown = null;
  let rpcError: { message: string } | null = null;

  try {
    const result = await supabase.rpc("confirm_encounter_investigations", {
      p_encounter_id: encounterId,
      p_practice_location_id: ctx.locationId,
      p_expected_version: expectedVersion,
      p_operation_key: operationKey,
      p_rows: investigations,
    });
    rpcData = result.data;
    rpcError = result.error;
  } catch {
    // Transport uncertainty can happen after the database committed. Never tell
    // the caller to invent a fresh key or submit the staged rows independently.
    console.error("[encounters] confirm investigations transport outcome unknown");
    return {
      ok: false,
      kind: "write-unconfirmed",
      operationKey,
      message: UNKNOWN_CONFIRMATION_MESSAGE,
    };
  }

  if (rpcError) {
    const translated = translateSaveError(rpcError.message);
    if (translated.unexpected) {
      console.error("[encounters] confirm_encounter_investigations failed");
    }

    if (translated.kind === "conflict") {
      const server = await getServerState(encounterId, ctx.locationId);
      if (!server) {
        return {
          ok: false,
          kind: "conflict-unloadable",
          operationKey,
          message: CONFLICT_UNLOADABLE_MESSAGE,
        };
      }
      return {
        ok: false,
        kind: "conflict",
        operationKey,
        message: translated.message,
        server,
      };
    }

    return {
      ok: false,
      kind: "error",
      operationKey,
      message: translated.message,
    };
  }

  const confirmation = parseConfirmationRpcRow(rpcData);
  if (!confirmation) {
    console.error("[encounters] confirm investigations returned unusable result");
    return {
      ok: false,
      kind: "write-unconfirmed",
      operationKey,
      message: UNKNOWN_CONFIRMATION_MESSAGE,
    };
  }

  /**
   * Never turn staged client rows into "saved" rows locally. A successful RPC
   * is followed by an authoritative database re-read of the entire encounter.
   */
  const server = await getServerState(encounterId, ctx.locationId);
  if (!server || server.version < confirmation.resultVersion) {
    console.error("[encounters] confirmed investigations could not be re-read");
    return {
      ok: false,
      kind: "write-unconfirmed",
      operationKey,
      message: UNKNOWN_CONFIRMATION_MESSAGE,
    };
  }

  return {
    ok: true,
    operationKey,
    confirmationVersion: confirmation.resultVersion,
    confirmedCount: confirmation.confirmedCount,
    replayed: confirmation.replayed,
    server,
  };
}
