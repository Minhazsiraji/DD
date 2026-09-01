"use client";

import * as React from "react";
import { Check, Copy, Link2 } from "lucide-react";

/**
 * Copy the doctor's public profile link.
 *
 * THE ORIGIN COMES FROM THE BROWSER, NOT FROM CONFIGURATION. A hard-coded
 * domain would be wrong on every preview deployment, wrong on localhost, and
 * wrong the day the product runs on a second domain — and the failure is
 * silent, because a copied link that goes to the wrong host still looks like a
 * link. `window.location.origin` is right everywhere by construction.
 *
 * Rendered as the path until it mounts, so the server and the browser agree on
 * the first paint. A component that renders a full URL on the server has to
 * guess the host, which is the same bug in a different place.
 */
export function CopyProfileLink({ path }: { path: string }) {
  /*
   * The origin is EXTERNAL state — it belongs to the browser, not to React —
   * so it is read as external state rather than copied into a state variable
   * from an effect. `useSyncExternalStore` also makes the server's answer
   * explicit: an empty string, because the server has no host to claim. It
   * never changes while the page is open, hence the no-op subscribe.
   */
  const origin = React.useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const url = origin ? `${origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /*
       * Clipboard access is refused in some browsers and every insecure
       * context. Selecting the text is the fallback that always works, so the
       * link stays visible and selectable rather than living only inside a
       * button that just failed.
       */
      setCopied(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2">
        <Link2 className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary" title={url}>
          {url}
        </span>
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        {copied ? (
          <Check className="size-4 text-[#07684a]" aria-hidden="true" />
        ) : (
          <Copy className="size-4 text-brand" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy link"}
      </button>
      {/* Announced rather than only coloured, for the same reason badges are. */}
      <span aria-live="polite" className="sr-only">
        {copied ? "Profile link copied to clipboard" : ""}
      </span>
    </div>
  );
}
