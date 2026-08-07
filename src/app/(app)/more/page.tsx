import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "More" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="More"
      phase="Phase 3"
      description="The overflow menu for medicines, documents, payments and settings on mobile."
    />
  );
}
