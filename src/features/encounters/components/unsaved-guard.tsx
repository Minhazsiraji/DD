"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

/**
 * Leaving a consultation with unsaved notes.
 *
 * `beforeunload` covers reload, closing the tab and typing a new URL. It does
 * NOT fire for client-side navigation, which is how a doctor actually leaves
 * this screen: a sidebar link, a search result, the browser's Back button. Any
 * of those would drop typed clinical text with no warning at all.
 *
 * So three routes are covered:
 *
 *   1. beforeunload      — reload / close / external
 *   2. captured clicks   — every internal link in the shell
 *   3. popstate          — Back and Forward
 *
 * Nothing is ever saved automatically on the way out. The doctor decides, and
 * cancelling leaves every character exactly where it was.
 */
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  /**
   * Read inside listeners that are registered once — a stale `dirty` captured
   * in a closure would let the guard lapse exactly when it is needed.
   *
   * Synced in an effect rather than during render: writing a ref while
   * rendering is what `react-hooks/refs` forbids, and the listeners only ever
   * read it after paint anyway.
   */
  const isDirty = React.useRef(dirty);
  React.useEffect(() => {
    isDirty.current = dirty;
  }, [dirty]);

  /** Set while we perform a navigation the doctor has already approved. */
  const leaving = React.useRef(false);
  /** True once we have pushed the history entry that Back lands on. */
  const sentinel = React.useRef(false);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (isDirty.current && !leaving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /**
   * Capture phase, so this runs before Next's Link handler and before any
   * onClick the link itself carries.
   */
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!isDirty.current || leaving.current) return;
      // Let modified clicks through — they open a new tab and leave this one be.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.target === "_blank") return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /**
   * Back and Forward.
   *
   * A duplicate history entry is pushed the first time the draft becomes dirty,
   * so the first Back lands on it rather than leaving. The handler stays
   * mounted once clean, purely to consume that spare entry — otherwise a saved
   * consultation would swallow one Back press, which is its own small lie.
   */
  React.useEffect(() => {
    if (!dirty || sentinel.current) return;
    window.history.pushState(null, "", window.location.href);
    sentinel.current = true;
  }, [dirty]);

  React.useEffect(() => {
    const onPop = () => {
      if (!sentinel.current) return;

      if (isDirty.current && !leaving.current) {
        // Undo the browser's move, then ask.
        window.history.pushState(null, "", window.location.href);
        setPending("__back__");
        return;
      }
      // Clean, or already approved: spend the spare entry rather than sitting on it.
      sentinel.current = false;
      window.history.back();
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function leave() {
    const target = pending;
    leaving.current = true;
    setPending(null);

    if (target === "__back__") {
      sentinel.current = false;
      window.history.go(-2);
      return;
    }
    if (target) router.push(target);
  }

  if (!pending) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center"
    >
      <div className="clinical-surface w-full max-w-sm rounded-glass-lg p-5 shadow-soft">
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="unsaved-title" className="text-[15px] font-semibold text-ink">
              Leave without saving?
            </h2>
            <p className="mt-1 text-[13px] text-ink-secondary">
              These notes have changes that are only on this screen. Leaving now discards them.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* Staying is the safe default, so it gets the emphasis. */}
          <button
            type="button"
            autoFocus
            onClick={() => setPending(null)}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover focus-visible:focus-ring"
          >
            Stay and save
          </button>
          <button
            type="button"
            onClick={leave}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-danger hover:bg-surface-muted focus-visible:focus-ring"
          >
            Leave without saving
          </button>
        </div>
      </div>
    </div>
  );
}
