import { runM1PreviewDiagnostic } from "@/features/perf/m1-preview-diagnostic";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function M1PerfDiagnosticPage() {
  const diagnostic = await runM1PreviewDiagnostic();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <pre className="overflow-x-auto rounded-lg border p-4 text-xs">
        {JSON.stringify(diagnostic, null, 2)}
      </pre>
    </main>
  );
}
