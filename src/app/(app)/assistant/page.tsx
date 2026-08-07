import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/common/phase-placeholder";

export const metadata: Metadata = { title: "AI Assistant" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="AI Assistant"
      phase="Phase 12"
      description="Patient summaries, record search and drafting. Mock provider only; live AI needs per-clinic opt-in."
    />
  );
}
