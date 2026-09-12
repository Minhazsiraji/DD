"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { buildEngagementPayload } from "../surfaces";

/**
 * Interaction-only engaged-use producer.
 *
 * AN IDLE TAB COUNTS ZERO, by construction rather than by threshold. There is
 * no timer anywhere in this file: no `setInterval`, no `setTimeout`, no polling
 * and no heartbeat loop. A request is only ever made from inside a handler for
 * a genuine user input event. A tab left open and untouched raises no event,
 * so it makes no request — ever.
 *
 * WHAT COUNTS AS INTERACTION: `pointerdown`, `keydown`, `wheel`, `touchstart`.
 *
 * Deliberately excluded:
 *   `scroll`        fires for programmatic and layout-driven scrolling too
 *   `mousemove`     would reward a resting hand; also a firehose
 *   route changes   a redirect or an auto-navigation is not the doctor acting;
 *                   a navigation the doctor caused already raised a pointer or
 *                   key event
 *   `focus`         fires when the browser returns to the tab, not when the
 *                   doctor does anything in it
 *
 * THE HANDLER NEVER RECEIVES THE EVENT. `onInteract` takes no argument, so it
 * cannot read which key was pressed, what was typed, what element was touched
 * or where. A keystroke tells us only that a minute was engaged.
 *
 * WHAT IS SENT: `{ surface }` — one closed enum value, derived from the path in
 * this tab and the path discarded. The server stamps the time.
 *
 * Known limitation, documented rather than worked around: typing the idle-lock
 * unlock password is keyboard interaction and marks that minute engaged. The
 * lock is a security control and this component does not reach into it.
 */

const INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Responses after which this tab stops trying until it reloads. */
const TERMINAL_STATUSES = new Set([401, 403, 503]);

export function EngagementBeacon() {
  const pathname = usePathname();
  const pathRef = React.useRef(pathname);

  // Synced in a layout effect, not during render — writing a ref while
  // rendering is impure and React may render without committing.
  React.useLayoutEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    let lastMinute = -1;
    let stopped = false;

    // No parameter, on purpose. See the header.
    const onInteract = () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;

      // Client clock is used ONLY to avoid sending twice in a minute. It is
      // never sent and never recorded; the server stamps its own minute and
      // de-duplicates regardless.
      const minute = Math.floor(Date.now() / 60_000);
      if (minute === lastMinute) return;

      const payload = buildEngagementPayload(pathRef.current);
      if (!payload) return;
      lastMinute = minute;

      void fetch("/api/engagement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "same-origin",
        cache: "no-store",
        // An expired session is answered by the proxy with a redirect to
        // /login. Following it would return 200 HTML and look like success.
        redirect: "manual",
      })
        .then((response) => {
          if (response.type === "opaqueredirect" || TERMINAL_STATUSES.has(response.status)) {
            stopped = true;
          }
        })
        .catch(() => {
          // Telemetry must never surface an error to a doctor mid-consultation.
        });
    };

    const options = { capture: true, passive: true } as const;
    for (const type of INTERACTION_EVENTS) window.addEventListener(type, onInteract, options);
    return () => {
      for (const type of INTERACTION_EVENTS) window.removeEventListener(type, onInteract, options);
    };
  }, []);

  return null;
}
