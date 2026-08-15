"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Trash2, Pencil, X } from "lucide-react";
import { emptyState } from "@/features/auth/schema";
import { FormMessage } from "@/features/auth/components/form-parts";
import { templateListAction } from "../actions";
import type { TemplateSettings } from "../schema";
import { TemplateEditor, type EditorLocation } from "./template-editor";
import type { PreviewDoctor } from "./prescription-preview";

/**
 * The template list, plus whichever editor is open.
 *
 * Only one editor at a time — a doctor comparing two layouts side by side is
 * not a real need, and two live previews on a phone is a scroll nightmare.
 */
export function TemplateManager({
  doctor,
  locations,
  templates,
}: {
  doctor: PreviewDoctor;
  locations: EditorLocation[];
  templates: TemplateSettings[];
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(templates.length === 0);
  const [listState, listAction] = useActionState(templateListAction, emptyState);
  const router = useRouter();

  React.useEffect(() => {
    if (listState.ok) router.refresh();
  }, [listState.ok, router]);

  const done = React.useCallback(() => {
    setEditing(null);
    setCreating(false);
  }, []);

  const locationName = (id: string | null) =>
    id === null
      ? "Everywhere"
      : (locations.find((l) => l.id === id)?.name ?? "A place you left");

  if (creating) {
    return (
      <Panel title="New template" onCancel={templates.length > 0 ? done : undefined}>
        <TemplateEditor doctor={doctor} locations={locations} onDone={done} />
      </Panel>
    );
  }

  const open = templates.find((t) => t.id === editing);
  if (open) {
    return (
      <Panel title={`Editing ${open.name}`} onCancel={done}>
        <TemplateEditor
          doctor={doctor}
          locations={locations}
          template={open}
          onDone={done}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="clinical-surface divide-y divide-hairline overflow-hidden rounded-glass">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {t.name}
                {/*
                  The badge names its scope. A doctor with a global default AND
                  a hospital default sees two correct defaults, and two badges
                  both reading "Default" looks like a contradiction.
                */}
                {t.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-[#07684a]">
                    <Star className="size-3" aria-hidden="true" />
                    {t.practiceLocationId === null
                      ? "Default everywhere"
                      : `Default at ${locationName(t.practiceLocationId)}`}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {t.practiceLocationId === null
                  ? "Every place you practise"
                  : `Only at ${locationName(t.practiceLocationId)}`}{" "}
                · {t.paperSize} · {t.baseFontPt}pt
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!t.isDefault ? (
                <form action={listAction}>
                  <input type="hidden" name="intent" value="default" />
                  <input type="hidden" name="templateId" value={t.id} />
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
                  >
                    <Star className="size-3.5" aria-hidden="true" />
                    {t.practiceLocationId === null
                      ? "Make default"
                      : `Make default at ${locationName(t.practiceLocationId)}`}
                  </button>
                </form>
              ) : null}

              <button
                type="button"
                onClick={() => setEditing(t.id ?? null)}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-hairline bg-white text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
                aria-label={`Edit ${t.name}`}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>

              <form action={listAction}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="templateId" value={t.id} />
                <button
                  type="submit"
                  className="inline-flex size-10 items-center justify-center rounded-xl border border-hairline bg-white text-danger transition-colors hover:bg-danger-soft focus-visible:focus-ring"
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <FormMessage state={listState} />

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand bg-white px-4 text-sm font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand-soft active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100"
      >
        <Plus className="size-4" aria-hidden="true" />
        New template
      </button>
    </div>
  );
}

function Panel({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <X className="size-4" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
