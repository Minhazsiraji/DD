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
               * The service-role client is intentionally private. Its generic
               * Supabase handle must never reach request-path code. Only the
               * signature-freeze modules and the reviewed O1 runtime authority
               * boundary below may import it directly.
               */
              group: ["**/supabase/service", "@/lib/supabase/service"],
              message:
                "The service-role client bypasses RLS. Use a reviewed domain authority " +
                "boundary; direct imports are restricted by this allowlist.",
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
     * The only modules permitted to import the privileged service module:
     * the service module itself, the existing signature-freeze holders, and
     * O1's single reviewed RPC-only runtime authority boundary. The O1 boundary
     * exposes named domain operations only; it never exports a Supabase client,
     * `.from()`, or arbitrary `.rpc()` primitive.
     */
    files: [
      "src/lib/supabase/service.ts",
      "src/lib/o1/runtime-authority.ts",
      "src/features/prescriptions/freeze-store.ts",
      "src/features/prescriptions/actions.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
