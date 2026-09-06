import "server-only";

export type PreviewTimer = bigint | null;

export function startPreviewTimer(): PreviewTimer {
  return process.env.VERCEL_ENV === "preview" ? process.hrtime.bigint() : null;
}

export function logPreviewElapsed(scope: string, stage: string, started: PreviewTimer): void {
  if (started === null) return;
  const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
  console.info(`[${scope}]`, JSON.stringify({ stage, ms: Math.round(elapsed) }));
}

export async function timedPreviewStage<T>(
  scope: string,
  stage: string,
  task: PromiseLike<T>,
): Promise<T> {
  const started = startPreviewTimer();
  try {
    return await task;
  } finally {
    logPreviewElapsed(scope, stage, started);
  }
}
