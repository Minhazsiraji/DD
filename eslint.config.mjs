import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  /**
   * SECURITY BOUNDARY — enforced, not merely documented.
   *
   * src/db/admin.ts opens a service-role connection where RLS DOES NOT APPLY.
   * Importing it from request-path code silently disables every row-level
   * protection in the product, and nothing else would catch it.
   *
   * Allowed callers are whitelisted in the override below.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/admin", "@/db/admin"],
              message:
                "src/db/admin.ts bypasses RLS. Use createSupabaseServerClient() " +
                "in request-path code. Only migrations and seed scripts may use it.",
            },
            {
              /**
               * The service-role Storage client. It exists so that trusted code
               * can write `prescription-assets`, which has no INSERT policy on
               * purpose — and for nothing else. Widening its reach is how a
               * privileged handle ends up one import away from a tenancy bug.
               */
              group: ["**/supabase/service", "@/lib/supabase/service"],
              message:
                "The service-role client bypasses RLS. Only the signature-freeze " +
                "modules may use it — see docs/decisions/0012-signature-freeze.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // The module itself, plus migration/seed entry points.
    files: ["src/db/admin.ts", "src/db/seed/**/*.ts", "drizzle/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    /**
     * The only modules permitted to hold the privileged Storage handle: the
     * client itself, the adapter that binds it to the freeze port, and the
     * action that decides a freeze should happen.
     */
    files: [
      "src/lib/supabase/service.ts",
      "src/features/prescriptions/freeze-store.ts",
      "src/features/prescriptions/actions.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
