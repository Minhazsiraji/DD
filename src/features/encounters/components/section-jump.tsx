"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { filterTargets, type JumpTarget } from "../fast-entry";

/**
 * GO TO A SECTION.
 *
 * A combobox in a dialog: type to filter, arrows to move, Enter to go, Escape
 * to leave. It moves the cursor and does nothing else — there is no control in
 * here that writes, and the list it offers comes from the workspace's own
 * resolved visibility, so a section the doctor turned off is not in it.
 *
 * HAND-ROLLED ON PURPOSE. shadcn here is Base UI, whose compound parts throw at
 * runtime when they are nested wrongly and compile perfectly while doing it —
 * and a crash in a component mounted on the consultation screen would take the
 * whole screen down mid-visit. This is a listbox and a text input; it does not
 * need a library, and this way there is nothing to get wrong.
 */
export function SectionJump({
  targets,
  onGo,
  onClose,
}: {
  targets: JumpTarget[];
  /** Focus the section. The caller decides how; this only says which. */
  onGo: (target: JumpTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const matches = React.useMemo(() => filterTargets(targets, query), [targets, query]);

  /** A filter that shortens the list must never leave the cursor past its end. */
  const index = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function keyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = matches[index];
      if (target) onGo(target);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(0, matches.length - 1));
    }
  }

  return (
    <div
      /*
        The backdrop closes on click but is NOT a button: a doctor who misses
        the dialog should get out, and a screen reader should not be told there
        is a control here to press.
      */
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-3 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go to a section of this consultation"
        className="clinical-surface w-full max-w-[420px] overflow-hidden rounded-glass-lg shadow-soft"
      >
        <div className="border-b border-hairline p-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
            aria-label="Search the sections on this consultation"
            placeholder="Go to…"
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={keyDown}
            className="h-11 w-full rounded-xl bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring"
          />
        </div>

        <ul id={listId} role="listbox" aria-label="Sections" className="max-h-[46vh] overflow-y-auto p-1.5">
          {matches.map((target, i) => (
            <li
              key={target.module}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              /*
                `onMouseDown`, not `onClick`: the input holds focus, and a click
                would blur it first — which on some browsers closes the dialog
                before the selection is read.
              */
              onMouseDown={(e) => {
                e.preventDefault();
                onGo(target);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center rounded-xl px-3 text-[14px]",
                i === index ? "bg-brand-soft font-semibold text-ink" : "text-ink-secondary",
              )}
            >
              {target.label}
            </li>
          ))}

          {matches.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-ink-muted" role="presentation">
              {/*
                Two different situations, said differently. "Nothing matches" on
                a consultation where every section is switched off would leave a
                doctor hunting for a typo that is not there.
              */}
              {targets.length === 0
                ? "Every section is switched off for this consultation."
                : "No section matches that."}
            </li>
          ) : null}
        </ul>

        <p className="border-t border-hairline px-3 py-2 text-[11px] text-ink-muted">
          <kbd className="font-sans font-semibold">↑</kbd>{" "}
          <kbd className="font-sans font-semibold">↓</kbd> to move ·{" "}
          <kbd className="font-sans font-semibold">Enter</kbd> to go ·{" "}
          <kbd className="font-sans font-semibold">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
