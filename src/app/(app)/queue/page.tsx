import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Live Queue" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Live Queue"
      phase="Phase 5"
      description="Token management, check-in, call next, skip, emergency insertion and reception handover."
    />
  );
}
