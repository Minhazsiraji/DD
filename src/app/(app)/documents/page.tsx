import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Documents"
      phase="Phase 10"
      description="The private patient document vault with signed URLs and access auditing."
    />
  );
}
