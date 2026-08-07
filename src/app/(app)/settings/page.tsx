import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Settings"
      phase="Phase 2"
      description="Doctor profile, clinic details, team members, roles and the audit log."
    />
  );
}
