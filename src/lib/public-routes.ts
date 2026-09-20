export const PUBLIC_CONTENT_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/pricing",
  "/security",
  "/faq",
  "/contact",
  "/about",
  "/for-doctors",
  "/learn",
  "/editorial-policy",
  "/medical-content-policy",
  "/corrections-policy",
  "/authors",
  "/reviewers",
  "/dr",
] as const;

export const AUTH_ENTRY_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
] as const;

export const PUBLIC_SYSTEM_PATHS = ["/robots.txt", "/sitemap.xml", "/api/health"] as const;

export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicRequestPath(pathname: string): boolean {
  return (
    PUBLIC_CONTENT_PATHS.some((path) => pathMatchesPrefix(pathname, path)) ||
    AUTH_ENTRY_PATHS.some((path) => pathMatchesPrefix(pathname, path)) ||
    PUBLIC_SYSTEM_PATHS.some((path) => pathMatchesPrefix(pathname, path)) ||
    pathname.startsWith("/auth/")
  );
}

export function isAuthEntryPath(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.some((path) => pathMatchesPrefix(pathname, path));
}
