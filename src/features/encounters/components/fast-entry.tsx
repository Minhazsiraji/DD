"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import { jumpTargets, resolveShortcut, type FastEntryAction, type JumpTarget } from "../fast-entry";
import type { VisibilityMap } from "../module-visibility";
import { VoiceLanguageControl } from "@/features/dictation/voice-language";
import { SectionJump } from "./section-jump";
import { ShortcutHelp } from "./shortcut-help";

/**
 * The Fast Entry controller.
 *
 * Owns the one global key listener, decides nothing itself — `resolveShortcut`
 * does — and mounts whichever surface is open. It writes nothing, and the two
 * surfaces it can open write nothing either.
 *
 * The destinations come from the workspace's OWN resolved visibility, passed in
 * rather than recomputed, so the palette and the screen can never disagree
 * about which sections exist.
 */
export function FastEntry({
  visibility,
  blocked,
}: {
  visibility: VisibilityMap;
  /** The coordinator owns the encounter: a write is in flight, or a conflict is open. */
  blocked: boolean;
}) {
  const [surface, setSurface] = React.useState<"jump" | "help" | null>(null);

  /**
   * Where the cursor was before the palette took it.
   *
   * Escaping out must put a doctor back in the sentence they were writing, not
   * at the top of the document — and losing the caret mid-note is precisely the
   * kind of small betrayal that stops a shortcut being used again.
   */
  const returnTo = React.useRef<HTMLElement | null>(null);

  /**
   * WHERE FOCUS GOES ONCE THE SURFACE IS GONE — the jump destination, or the
   * caret we borrowed.
   *
   * NOT `requestAnimationFrame`. rAF does not fire in a tab that is not
   * compositing — a background tab, a throttled one, or the preview pane this
   * was smoke-tested in — and the failure is silent: the dialog closes and the
   * doctor's cursor is simply gone from the sentence they were writing. A
   * layout effect runs after the DOM is committed and before paint, every time,
   * with nothing to schedule.
   */
  const focusAfterClose = React.useRef<{ el: HTMLElement; scroll: boolean } | null>(null);

  const targets = React.useMemo(() => jumpTargets(visibility), [visibility]);

  React.useLayoutEffect(() => {
    if (surface !== null) return;
    const next = focusAfterClose.current;
    focusAfterClose.current = null;
    if (!next) return;

    if (next.scroll) {
      /**
       * Respect the viewer's motion setting. A doctor who has asked for reduced
       * motion has asked for it here too, and this is exactly the incidental
       * animation that setting exists for.
       */
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

      /**
       * Stop the chord reaching the page. On macOS Option+G types "©" and
       * Option+H types "˙" — without this, opening the palette would leave a
       * stray character in the note the doctor was writing.
       */
      event.preventDefault();

      if (action === "dismiss") {
        close();
        return;
      }

      // Remember the caret BEFORE the surface steals focus.
      returnTo.current = target && typeof target.focus === "function" ? target : null;
      setSurface(action === "open-jump" ? "jump" : "help");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked, surface, close]);

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {/* One language choice drives every draft-only Dictate button. */}
        <VoiceLanguageControl disabled={blocked} />

        {/*
          A visible way in, because a shortcut nobody knows about is a shortcut
          nobody uses — and because the palette must be reachable by touch and by
          Tab, not only by a chord. Hidden from print like every other control.
        */}
        <button
          type="button"
          data-print-hidden
          onClick={() => {
            returnTo.current = document.activeElement as HTMLElement | null;
            setSurface("jump");
          }}
          disabled={blocked}
          aria-keyshortcuts="Alt+G"
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          <Keyboard className="size-4" aria-hidden="true" />
          Go to section
          <kbd className="hidden font-sans text-[11px] font-medium text-ink-muted sm:inline">
            Alt&nbsp;G
          </kbd>
        </button>
      </div>

      {surface === "jump" ? (
        <SectionJump targets={targets} onGo={go} onClose={close} />
      ) : null}
      {surface === "help" ? <ShortcutHelp onClose={close} /> : null}
    </>
  );
}
