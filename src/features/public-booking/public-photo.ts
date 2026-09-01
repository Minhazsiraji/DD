/**
 * THE ONLY SHAPE A PUBLIC PORTRAIT MAY TAKE.
 *
 * The private profile stores `professional_photo_path` — a key into a private
 * bucket. That key is not public data and never becomes any: the Edge Function
 * takes a slug, re-checks PUBLIC visibility itself, derives the doctor's own
 * fixed path server-side and returns one short-lived signed URL. This app never
 * holds a path, so it cannot leak one, and no path a caller supplies can be
 * turned into a portrait.
 *
 * This is the last gate before whatever comes back is rendered as an `<img>`
 * on an anonymous page.
 */
export function safePublicPhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not absolute. A bare path here would resolve against our own origin and
    // quietly turn a storage key into a request from the browser.
    return null;
  }

  /**
   * HTTPS ONLY, and nothing that carries a payload of its own.
   *
   * `data:` and `blob:` can embed script in an `<img>` on some surfaces,
   * `javascript:` is obvious, and `http:` would downgrade a signed URL onto
   * the wire in plain text.
   */
  if (url.protocol !== "https:") return null;

  // Credentials in a URL are never something a signed portrait link needs, and
  // they are a classic way to smuggle a different destination past a reader.
  if (url.username || url.password) return null;

  return url.toString();
}
