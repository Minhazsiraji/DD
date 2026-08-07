import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Reports"
      phase="Phase 6"
      description="Investigation orders and results, abnormal-value flagging, and review state per encounter."
    />
  );
}
