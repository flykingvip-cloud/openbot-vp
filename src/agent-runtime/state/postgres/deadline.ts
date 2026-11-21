/** Bounds waiting; does not pretend to cancel underlying PostgreSQL work. Driver timeouts also apply. */
export async function withRuntimeDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (!Number.isSafeInteger(ms) || ms < 1) {
    throw new Error("Invalid runtime deadline");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
export const RUNTIME_PG_OPTIONS = {
  max: 2,
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
  statement_timeout: 10000,
};
export const RUNTIME_SHUTDOWN_MS = 12000;
