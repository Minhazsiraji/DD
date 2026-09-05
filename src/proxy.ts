import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

/**
 * Next.js 16 renamed `middleware` to `proxy`. Runtime is nodejs and is not
 * configurable.
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie on every request. Server Components
 *      cannot write cookies, so without this the session silently expires.
 *   2. Gate protected routes.
 *
 * This is a convenience redirect, NOT the security boundary. Every Server
 * Action still calls requireLocationContext(), and RLS still applies underneath.
 * Never let this file be the only thing standing between a user and data.
 */

const PUBLIC_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/pricing",
  "/security",
  "/faq",
  "/contact",
  "/dr",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  // Version marker. Must stay reachable signed-out, or it cannot answer the
  // one question it exists for: which commit is live?
  "/api/health",
];
const AUTH_ONLY_PATHS = ["/onboarding"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`))) ||
    pathname.startsWith("/auth/")
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the JWT against the auth server. getSession() only
  // reads the cookie and can be forged — never use it for an authz decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve intent so sign-in returns the user where they were headed.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users get bounced off the sign-in screens — but never off API
  // routes, which must answer identically regardless of session.
  if (
    user &&
    isPublic(pathname) &&
    pathname !== "/" &&
    !pathname.startsWith("/features") &&
    !pathname.startsWith("/how-it-works") &&
    !pathname.startsWith("/pricing") &&
    !pathname.startsWith("/security") &&
    !pathname.startsWith("/faq") &&
    !pathname.startsWith("/contact") &&
    !pathname.startsWith("/dr/") &&
    !pathname.startsWith("/auth/") &&
    !pathname.startsWith("/api/") &&
    pathname !== "/reset-password"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  void AUTH_ONLY_PATHS;
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Keeping the proxy off
     * the asset path matters: it runs a network call to the auth server, and
     * doing that per icon would be slow and pointless.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js)$).*)",
  ],
};

