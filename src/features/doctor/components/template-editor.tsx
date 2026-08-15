"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { saveTemplateAction } from "../actions";
import { DEFAULT_TEMPLATE, type TemplateSettings, type TemplateActionState } from "../schema";
import { PrescriptionPreview, type PreviewDoctor, type PreviewLocation } from "./prescription-preview";
import { ToggleRow, TextRow, SelectRow, NumberRow } from "./setting-controls";

/**
 * Template editor with a live A4 preview.
 *
 * The preview is the point. A doctor cannot tell from a list of checkboxes what
 * their prescription will look like, and the cost of finding out on paper is a
 * wasted pad.
 */

export interface EditorLocation {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  phone: string | null;
}

const initialState: TemplateActionState = { ok: false };

export function TemplateEditor({
  doctor,
  locations,
  template,
  onDone,
}: {
  doctor: PreviewDoctor;
  locations: EditorLocation[];
  template?: TemplateSettings;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(saveTemplateAction, initialState);
  const [settings, setSettings] = React.useState<TemplateSettings>(
    template ?? { ...DEFAULT_TEMPLATE, name: "" },
  );
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onDone?.();
    }
  }, [state.ok, router, onDone]);

  const set = React.useCallback(
    <K extends keyof TemplateSettings>(key: K, value: TemplateSettings[K]) =>
      setSettings((s) => ({ ...s, [key]: value })),
    [],
  );

  const scoped = locations.find((l) => l.id === settings.practiceLocationId) ?? null;
  const previewLocation: PreviewLocation | null = scoped ?? locations[0] ?? null;

  const locationOptions = [
    { value: "", label: "Every place I practise" },
    ...locations.map((l) => ({ value: l.id, label: `Only at ${l.name}` })),
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <form action={formAction} className="space-y-5" noValidate>
        {template?.id ? <input type="hidden" name="templateId" value={template.id} /> : null}

        <div className="clinical-surface space-y-4 rounded-glass p-4 sm:p-5">
          <TextRow
            label="Template name"
            name="name"
            value={settings.name}
            onChange={(v) => set("name", v)}
            placeholder="e.g. Chamber pad"
            maxLength={80}
            hint="Only you see this."
            errors={state.fieldErrors?.name}
          />

          <SelectRow
            label="Where this applies"
            name="practiceLocationId"
            value={settings.practiceLocationId ?? ""}
            onChange={(v) => set("practiceLocationId", v || null)}
            options={locationOptions}
            hint="A hospital pad and a private chamber pad usually differ. A location-specific template wins over your general one."
          />

          <SelectRow
            label="Paper"
            name="paperSize"
            value={settings.paperSize}
            onChange={(v) => set("paperSize", v as "A4" | "A5")}
            options={[
              { value: "A4", label: "A4 — 210 × 297 mm" },
              { value: "A5", label: "A5 — 148 × 210 mm" },
            ]}
          />

          <NumberRow
            label="Margin"
            name="marginMm"
            value={settings.marginMm}
            onChange={(v) => set("marginMm", v)}
            min={5}
            max={40}
            unit="mm"
            hint="Most printers cannot print closer than 5 mm to the edge."
          />

          <NumberRow
            label="Text size"
            name="baseFontPt"
            value={settings.baseFontPt}
            onChange={(v) => set("baseFontPt", v)}
            min={8}
            max={16}
            unit="pt"
          />
        </div>

        <div className="clinical-surface space-y-1 rounded-glass p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-ink">Header</h3>

          <ToggleRow
            label="Print a header"
            hint="Turn this off if your pads are already printed with your letterhead."
            name="showHeader"
            checked={settings.showHeader}
            onChange={(v) => set("showHeader", v)}
          />

          <div className="divide-y divide-hairline">
            <ToggleRow
              label="Qualifications"
              name="showQualification"
              checked={settings.showQualification}
              onChange={(v) => set("showQualification", v)}
              disabled={!settings.showHeader}
            />
            <ToggleRow
              label="Specialty"
              name="showSpecialization"
              checked={settings.showSpecialization}
              onChange={(v) => set("showSpecialization", v)}
              disabled={!settings.showHeader}
            />
            <ToggleRow
              label="Designation"
              name="showDesignation"
              checked={settings.showDesignation}
              onChange={(v) => set("showDesignation", v)}
              disabled={!settings.showHeader}
            />
            <ToggleRow
              label="BMDC registration number"
              name="showBmdc"
              checked={settings.showBmdc}
              onChange={(v) => set("showBmdc", v)}
            />
            <ToggleRow
              label="Chamber address"
              name="showChamberAddress"
              checked={settings.showChamberAddress}
              onChange={(v) => set("showChamberAddress", v)}
              disabled={!settings.showHeader}
            />
            <ToggleRow
              label="Chamber phone"
              name="showChamberPhone"
              checked={settings.showChamberPhone}
              onChange={(v) => set("showChamberPhone", v)}
              disabled={!settings.showHeader}
            />
            <ToggleRow
              label="Space for a clinic logo"
              name="showClinicLogo"
              checked={settings.showClinicLogo}
              onChange={(v) => set("showClinicLogo", v)}
              disabled={!settings.showHeader}
            />
          </div>

          <div className="space-y-4 pt-3">
            <TextRow
              label="Clinic name to print"
              name="clinicNameOverride"
              value={settings.clinicNameOverride ?? ""}
              onChange={(v) => set("clinicNameOverride", v || null)}
              maxLength={160}
              placeholder={previewLocation?.name ?? "Your chamber"}
              hint="Leave blank to use the name of the place itself."
            />
            <TextRow
              label="Note under the header"
              name="headerNote"
              value={settings.headerNote ?? ""}
              onChange={(v) => set("headerNote", v || null)}
              maxLength={200}
              placeholder="e.g. Consultation hours: 6pm – 9pm, closed Friday"
            />
          </div>
        </div>

        <div className="clinical-surface space-y-4 rounded-glass p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-ink">Signature &amp; footer</h3>

          <ToggleRow
            label="Print a signature line"
            name="showSignature"
            checked={settings.showSignature}
            onChange={(v) => set("showSignature", v)}
          />
          <ToggleRow
            label="Print a footer"
            name="showFooter"
            checked={settings.showFooter}
            onChange={(v) => set("showFooter", v)}
          />
          <TextRow
            label="Footer text"
            name="footerText"
            value={settings.footerText ?? ""}
            onChange={(v) => set("footerText", v || null)}
            maxLength={300}
            placeholder="e.g. Please bring this prescription and all reports on your next visit."
          />
        </div>

        <FormMessage state={state} />

        <div className="sm:max-w-56">
          <SubmitButton>{template?.id ? "Save changes" : "Create template"}</SubmitButton>
        </div>
      </form>

      <div className="lg:sticky lg:top-24">
        <p className="mb-2 text-xs font-medium text-ink-secondary">
          Preview — {settings.paperSize}, actual proportions
        </p>
        <PrescriptionPreview
          template={settings}
          doctor={doctor}
          location={previewLocation}
        />
        <p className="mt-2 text-xs text-ink-muted">
          The body is left empty on purpose. Prescription writing arrives in a
          later step — this sets up the paper it prints on.
        </p>
      </div>
    </div>
  );
}
