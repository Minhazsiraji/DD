import * as React from "react";
import { CircleAlert } from "lucide-react";

/**
 * A SNAPSHOT THIS BUILD CANNOT PRINT.
 *
 * Reached when a stored prescription carries a schema version no renderer in
 * this build claims — a record written by a newer deployment, read by an older
 * one. It should be unreachable in practice, because `parseReview` refuses the
 * same versions from the same list; it exists because the alternative to
 * handling it is rendering nothing, and a prescription screen showing nothing
 * looks exactly like a prescription with nothing on it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not fall back to the previous renderer. A newer bundle carries
 * content the old renderer cannot see, so that fallback prints a SHORTER
 * prescription than the one the doctor signed, with nothing on screen to say
 * so. Refusing is the safe outcome; guessing is not.
 *
 * The record is intact either way — this is a display limit, and the text says
 * so, because "could not be displayed" and "was lost" are very different things
 * to read about a clinical record.
 */
export function UnsupportedSnapshot({ found }: { found: unknown }) {
  return (
    <div
      role="alert"
      className="clinical-surface mx-auto flex max-w-[820px] items-start gap-2 rounded-glass border-l-4 border-l-warning px-4 py-3 text-[13px] text-ink-secondary"
    >
      <CircleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        <strong className="font-semibold text-ink">
          This prescription cannot be shown by this version of the app.
        </strong>{" "}
        The record is safely stored and unchanged — it was written in a newer format
        {typeof found === "number" ? ` (format ${found})` : ""} than this build understands. Reload
        the page; if it keeps happening, this device needs the latest version. Nothing is displayed
        rather than a partial prescription, because a partial one could be acted on.
      </span>
    </div>
  );
}
