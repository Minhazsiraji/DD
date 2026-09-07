import { notFound } from "next/navigation";
import { PrintPrescription } from "@/features/prescriptions/components/print-prescription";
import { PRINT_SCENARIOS } from "@/features/prescriptions/print-fixtures";
import { toPrescriptionView } from "@/features/prescriptions/prescription-view";

export const dynamic = "force-dynamic";

export default function PrintRegressionPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const scenario = PRINT_SCENARIOS.find((item) => item.id === "v3-historical");
  const render = scenario ? toPrescriptionView(scenario.bundle) : null;
  if (!render?.ok) return <p>Fixture unavailable</p>;

  return (
    <main className="p-6">
      <div data-qa-app-chrome>APP CHROME SENTINEL</div>
      <PrintPrescription
        prescriptionId="11111111-2222-4333-8444-555555555555"
        view={render.view}
      />
    </main>
  );
}
