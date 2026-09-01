import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("P0 mobile responsive boundaries", () => {
  it("keeps the authenticated workspace inside the viewport and above mobile navigation", () => {
    const layout = source("src/app/(app)/layout.tsx");
    expect(layout).toContain("overflow-x-clip");
    expect(layout).toContain("min-w-0");
    expect(layout).toContain("pb-[calc(76px+env(safe-area-inset-bottom))]");
  });

  it("lets standard page and clinical-card actions stack instead of forcing intrinsic width", () => {
    const header = source("src/components/common/page-header.tsx");
    const card = source("src/components/common/section-card.tsx");

    expect(header).toContain("w-full min-w-0 flex-col items-stretch");
    expect(header).toContain("sm:flex-row");
    expect(card).toContain("clinical-surface min-w-0");
    expect(card).toContain("flex-wrap");
    expect(card).toContain("w-full min-w-0 sm:w-auto");
  });

  it("stacks every appointment-card action on phones without changing desktop layout", () => {
    const appointment = source("src/features/appointments/components/appointment-card.tsx");

    expect(appointment).toContain("data-mobile-appointment-actions");
    expect(appointment).toContain(
      "w-full min-w-0 shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row",
    );
    expect(appointment).toContain('className="w-full sm:w-auto"');
    expect(appointment).toContain("h-11 w-full items-center justify-center");
    expect(appointment).toContain("sm:h-10 sm:w-auto");
    expect(appointment).toContain("Confirmed by phone");
    expect(appointment).toContain("They did not come");
  });

  it("keeps every patient timeline filter reachable on narrow screens", () => {
    const timeline = source("src/features/patients/components/patient-timeline.tsx");
    expect(timeline).toContain("data-mobile-timeline-filters");
    expect(timeline).toContain("flex-wrap");
    expect(timeline).toContain("sm:flex-nowrap");
  });

  it("stacks terminal consultation controls and keeps the save bar keyboard-friendly", () => {
    const finish = source("src/features/encounters/components/finish-consultation.tsx");
    const save = source("src/features/encounters/components/save-bar.tsx");

    expect(finish).toContain("data-mobile-finish-confirmation");
    expect(finish).toContain("w-full items-center justify-center");
    expect(save).toContain("data-mobile-save-bar");
    expect(save).toContain("glass-strong sticky bottom-0");
    expect(save).not.toContain("glass-strong fixed bottom-0");
  });

  it("contains the prescription preview while leaving print layout in its dedicated renderer", () => {
    const finalRx = source("src/features/prescriptions/components/finalized-prescription.tsx");
    const preview = source("src/features/prescriptions/components/review-sheet.tsx");
    const print = source("src/features/prescriptions/components/print-sheet.tsx");

    expect(finalRx).toContain("flex-col items-stretch gap-2 sm:flex-row");
    expect(preview).toContain("data-mobile-prescription-preview");
    expect(preview).toContain("max-w-full");
    expect(preview).toContain("overflow-x-auto");
    expect(print).toContain("data-print-root");
  });

  it("keeps every document control reachable and tappable at 360px", () => {
    const list = source("src/features/documents/components/document-list.tsx");
    const remove = source("src/features/documents/components/document-row-actions.tsx");
    const filters = source("src/features/documents/components/document-filters.tsx");

    // Row actions stack full-width on a phone and go inline from `sm`.
    expect(list).toContain("data-mobile-document-actions");
    expect(list).toContain("w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row");
    expect(list).toContain("h-11 w-full items-center justify-center");
    expect(list).toContain("sm:h-10 sm:w-auto");
    // A long report title must wrap, never widen the page.
    expect(list).toContain("min-w-0 break-words");

    expect(remove).toContain("data-mobile-document-remove");
    expect(remove).toContain("w-full min-w-0 rounded-glass");
    expect(remove).toContain("mt-3 flex w-full flex-col items-stretch gap-2 sm:flex-row");

    // Filters stack rather than scroll sideways — a filter you cannot see is a
    // filter that stays wrong.
    expect(filters).toContain("data-mobile-document-filters");
    expect(filters).toContain("grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4");
    // 16px inputs, or iOS zooms the page on focus and the layout is lost.
    expect(filters).toContain("text-base");
  });

  it("keeps the upload flow usable one-handed", () => {
    const form = source("src/features/documents/components/upload-form.tsx");
    const upload = source("src/app/(app)/documents/upload/page.tsx");

    expect(form).toContain("data-document-review");
    expect(form).toContain("h-12 w-full items-center justify-center");
    expect(form).toContain("sm:h-11 sm:w-auto");
    expect(form).toContain("flex w-full min-w-0 flex-col items-stretch gap-2 sm:flex-row");
    // The field class is 44px+ and 16px text.
    expect(form).toContain("h-11 w-full min-w-0 rounded-xl");
    expect(form).toContain("text-base text-ink");

    // Choosing a patient is its own screen, not a combobox squeezed above a form.
    expect(upload).toContain("Step 1 of 2");
    expect(upload).toContain("Step 2 of 2");
    expect(upload).toContain("min-h-[56px]");
    expect(upload).toContain("h-12 w-full rounded-glass");
  });

  it("makes public booking and finalization primary actions mobile-width safe", () => {
    const booking = source("src/app/dr/[slug]/book/page.tsx");
    const finalize = source("src/features/prescriptions/components/finalize-panel.tsx");

    expect(booking).toContain("min-h-11 min-w-0 w-full");
    expect(booking).toContain("Confirm booking");
    expect(finalize).toContain("data-mobile-finalize-confirmation");
    expect(finalize).toContain("w-full items-center justify-center");
  });
});
