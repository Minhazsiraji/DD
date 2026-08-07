import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Appointments" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Appointments"
      phase="Phase 4"
      description="Booking, the confirmation state machine, rescheduling, cancellation and the calendar."
    />
  );
}
