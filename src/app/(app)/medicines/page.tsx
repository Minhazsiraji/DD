import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Medicine Intelligence" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Medicine Intelligence"
      phase="Phase 9"
      description="Generic and brand search, monographs with per-field provenance, and patient-aware safety checks."
    />
  );
}
