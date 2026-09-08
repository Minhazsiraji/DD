import "server-only";

import { isPlatformOwner } from "@/features/owner/authority";

export type PostMfaDestination = "/owner" | "/dashboard";

const OWNER_DESTINATION: PostMfaDestination = "/owner";
const CLINICAL_DESTINATION: PostMfaDestination = "/dashboard";

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

  if (typeof requestedPath !== "string") return authorizedDestination;

  // Exact allowlist only. Reject absolute URLs, protocol-relative URLs,
  // encoded/external targets, and internal paths outside the authorized surface.
  if (requestedPath !== OWNER_DESTINATION && requestedPath !== CLINICAL_DESTINATION) {
    return authorizedDestination;
  }

  return requestedPath === authorizedDestination
    ? authorizedDestination
    : authorizedDestination;
}
