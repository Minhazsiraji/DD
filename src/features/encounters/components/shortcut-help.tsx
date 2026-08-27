"use client";

import * as React from "react";
import { SHORTCUTS } from "../fast-entry";

/**
 * What the keyboard does.
 *
 * Reachable while the screen is BLOCKED, unlike everything else here: a doctor
 * whose shortcuts have just gone quiet is exactly the person who needs to read
 * why. It shows text and closes; it cannot change anything.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-3 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fast-entry-help-title"
        className="clinical-surface w-full max-w-[420px] rounded-glass-lg p-4 shadow-soft sm:p-5"
      >
        <h2 id="fast-entry-help-title" className="text-[15px] font-semibold text-ink">
          Keyboard shortcuts
        </h2>

        <dl className="mt-3 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-ink-secondary">{s.description}</dt>
              <dd>
                <kbd className="rounded-lg border border-hairline bg-surface-muted px-2 py-0.5 font-sans text-[12px] font-semibold text-ink">
                  {s.chord}
                </kbd>
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-ink-secondary">Close this, or the section list</dt>
            <dd>
              <kbd className="rounded-lg border border-hairline bg-surface-muted px-2 py-0.5 font-sans text-[12px] font-semibold text-ink">
                Esc
              </kbd>
            </dd>
          </div>
        </dl>

        {/*
          Said plainly, because a doctor pressing a dead shortcut mid-visit will
          otherwise assume the app has hung.
        */}
        <p className="mt-4 text-[12px] text-ink-muted">
          Shortcuts move the cursor and nothing else — they never save, approve or finish anything.
          While a save is in flight or a change needs answering, they stop working until that is
          settled.
        </p>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          Close
        </button>
      </div>
    </div>
  );
}
