/**
 * Typed application errors.
 *
 * Authorization failures must never leak whether a resource exists — that is
 * itself an information disclosure. `NotFoundError` and `ForbiddenError` should
 * present identically to an unauthenticated caller.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "NO_ACTIVE_LOCATION"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Safe to show a user. Never include record contents or existence hints. */
  readonly publicMessage: string;

  constructor(
    code: AppErrorCode,
    publicMessage: string,
    status: number,
    internalMessage?: string,
  ) {
    super(internalMessage ?? publicMessage);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export const unauthenticated = (detail?: string) =>
  new AppError("UNAUTHENTICATED", "Please sign in to continue.", 401, detail);

export const forbidden = (detail?: string) =>
  new AppError(
    "FORBIDDEN",
    "You do not have permission to do that.",
    403,
    detail,
  );

export const notFound = (detail?: string) =>
  new AppError("NOT_FOUND", "You do not have permission to do that.", 403, detail);

export const validationFailed = (detail?: string) =>
  new AppError("VALIDATION", "Please check the highlighted fields.", 422, detail);

export const conflict = (publicMessage: string, detail?: string) =>
  new AppError("CONFLICT", publicMessage, 409, detail);

export const noActiveLocation = (detail?: string) =>
  new AppError(
    "NO_ACTIVE_LOCATION",
    "Select a practice location to continue.",
    409,
    detail,
  );

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Never surface a raw error to a user — it may carry SQL or row contents. */
export function toPublicMessage(e: unknown): string {
  return isAppError(e)
    ? e.publicMessage
    : "Something went wrong. Please try again.";
}


