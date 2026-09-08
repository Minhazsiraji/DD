import "server-only";

import { isPlatformOwner } from "@/features/owner/authority";

export type PostMfaDestination = "/owner" | "/dashboard";

const OWNER_DESTINATION: PostMfaDestination = "/owner";
const CLINICAL_DESTINATION: PostMfaDestination = "/dashboard";

export function isAllowedPostMfaDestination(
  value: unknown,
): value is PostMfaDestination {
  return value === OWNER_DESTINATION || value === CLINICAL_DESTINATION;
}

/**
 * Resolve the destination after an AAL2 upgrade on the server.
 *
 * Platform Owner identity remains database-backed through isPlatformOwner().
 * A caller-supplied return path can never choose a different authority surface:
 * only the exact destination already authorized for that user is accepted.
 */
export async function resolvePostMfaDestination(
  requestedPath: unknown = null,
): Promise<PostMfaDestination> {
  const authorizedDestination = (await isPlatformOwner())
    ? OWNER_DESTINATION
    : CLINICAL_DESTINATION;

  if (!isAllowedPostMfaDestination(requestedPath)) {
    return authorizedDestination;
  }

  return requestedPath === authorizedDestination
    ? requestedPath
    : authorizedDestination;
}
