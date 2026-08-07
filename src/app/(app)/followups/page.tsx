import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Follow-ups" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Follow-ups"
      phase="Phase 10"
      description="Recommended, booked, completed and overdue follow-ups, including after-reports triggers."
    />
  );
}
