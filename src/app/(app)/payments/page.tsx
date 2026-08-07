import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Payments" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Payments"
      phase="Phase 11"
      description="Consultation fees, deposits, manual bKash/Nagad/cash entry and refunds."
    />
  );
}
