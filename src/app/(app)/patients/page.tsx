import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Patients" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Patients"
      phase="Phase 3"
      description="Registration, duplicate-aware search, the medical profile and the clinical timeline."
    />
  );
}
