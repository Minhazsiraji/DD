"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import {
  directJumpTarget,
  jumpTargets,
  resolveShortcut,
  type DirectAction,
  type FastEntryAction,
  type JumpTarget,
} from "../fast-entry";
import type { VisibilityMap } from "../module-visibility";
import { SectionJump } from "./section-jump";
import { ShortcutHelp } from "./shortcut-help";

/** Focus-only Fast Entry controller. */
export function FastEntry({
  visibility,
  blocked,
}: {
  visibility: VisibilityMap;
  blocked: boolean;
}) {
  const [surface, setSurface] = React.useState<"jump" | "help" | null>(null);
  const returnTo = React.useRef<HTMLElement | null>(null);
  const focusAfterClose = React.useRef<{ el: HTMLElement; scroll: boolean } | null>(null);
  const targets = React.useMemo(() => jumpTargets(visibility), [visibility]);

  React.useLayoutEffect(() => {
    if (surface !== null) return;
    const next = focusAfterClose.current;
    focusAfterClose.current = null;
    if (!next) return;

    if (next.scroll) {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      next.el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    next.el.focus({ preventScroll: next.scroll });
  }, [surface]);

  const close = React.useCallback(() => {
    const el = returnTo.current;
    returnTo.current = null;
    if (el) focusAfterClose.current = { el, scroll: false };
    setSurface(null);
  }, []);

  const go = React.useCallback((target: JumpTarget) => {
    returnTo.current = null;
    const el = document.getElementById(target.elementId);
    if (el) focusAfterClose.current = { el, scroll: true };
    setSurface(null);
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const action: FastEntryAction | null = resolveShortcut(
        {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          target: {
            tagName: target?.tagName ?? "",
            isContentEditable: target?.isContentEditable ?? false,
            role: target?.getAttribute?.("role") ?? null,
          },
        },
        { blocked, open: surface !== null },
      );

      if (action === null) return;
      event.preventDefault();

      if (action === "dismiss") {
        close();
        return;
      }

      if (action.startsWith("direct-")) {
        const destination = directJumpTarget(action as DirectAction, visibility);
        if (destination) go(destination);
        return;
      }

      returnTo.current = target && typeof target.focus === "function" ? target : null;
      setSurface(action === "open-help" ? "help" : "jump");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked, surface, close, go, visibility]);

  return (
    <>
      <button
        type="button"
        data-print-hidden
        onClick={() => {
          returnTo.current = document.activeElement as HTMLElement | null;
          setSurface("jump");
        }}
        disabled={blocked}
        aria-keyshortcuts="Control+K Meta+K Alt+G"
        className="dd-secondary inline-flex h-11 items-center gap-1.5 px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
      >
        <Keyboard className="size-4" aria-hidden="true" />
        Go to section
        <kbd className="hidden font-sans text-[11px] font-medium sm:inline">Ctrl/Cmd&nbsp;K</kbd>
      </button>

      {surface === "jump" ? <SectionJump targets={targets} onGo={go} onClose={close} /> : null}
      {surface === "help" ? <ShortcutHelp onClose={close} /> : null}
    </>
  );
}
