const CONSULTATION_RETURN = /^\/consultation\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accept only an exact in-app consultation path as a history return target.
 *
 * Previous-record links are server-rendered and may carry `returnTo` through a
 * query string. Treating that value as an arbitrary href would create an open
 * redirect / navigation escape. A current consultation is the only destination
 * this workflow needs, so the allow-list is deliberately narrow.
 */
export function safeConsultationReturn(
  value: string | string[] | undefined | null,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  return CONSULTATION_RETURN.test(candidate) ? candidate : null;
}

/** Add the already-validated return target to one known internal destination. */
export function withConsultationReturn(href: string, returnTo: string | null): string {
  return returnTo ? `${href}?returnTo=${encodeURIComponent(returnTo)}` : href;
}
