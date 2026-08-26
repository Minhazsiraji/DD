import { notFound } from "next/navigation";
import { PrintHarness } from "@/features/prescriptions/components/print-harness";

/**
 * The prescription print harness.
 *
 * DEVELOPMENT ONLY. It renders synthetic bundles through the real renderer so a
 * layout change can be seen on paper before a patient carries one — and it is
 * `notFound()` in a production build, so the route does not exist there at all.
 *
 * It sits inside `(app)` on purpose: the ordinary authenticated shell, with no
 * change to the public-path allowlist. A harness is not worth widening the
 * auth surface for, and this one reads nothing that would need it.
 */
export const dynamic = "force-dynamic";

export default function PrintHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto w-full max-w-[900px] px-3 py-6 sm:px-6">
      <PrintHarness />
    </div>
  );
}
