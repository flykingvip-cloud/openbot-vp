const CHUNK_RELOAD_KEY = "openbot:stale-chunk-reload";
const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleDynamicImportError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return STALE_CHUNK_RE.test(message);
}

/**
 * Vite asset hashes change on every UI pin cutover. Stale tabs keep the old index
 * in memory and repeatedly 404 on retired chunks (e.g. growth-task-gate-*.js).
 * One hard reload picks up the current pin; further failures surface normally.
 */
export async function importWithStaleChunkReload<T>(loader: () => Promise<T>): Promise<T> {
  try {
    const mod = await loader();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    }
    return mod;
  } catch (error) {
    if (
      isStaleDynamicImportError(error) &&
      typeof window !== "undefined" &&
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(CHUNK_RELOAD_KEY) !== "1"
    ) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
      return new Promise<T>(() => {
        // Page is reloading; keep the caller pending.
      });
    }
    throw error;
  }
}
