type ShellHost = {
  requestUpdate?: () => void;
};

const shellModules = new Map<string, unknown>();
const shellInflight = new Map<string, Promise<unknown>>();

/**
 * Synchronously return a cached dynamically-imported shell module, or kick off
 * the import and request a re-render when it lands. First paint for a surface
 * may show a lightweight placeholder until the shell chunk arrives.
 */
export function loadShellModule<T>(
  key: string,
  loader: () => Promise<T>,
  host: ShellHost,
): T | null {
  const cached = shellModules.get(key);
  if (cached) {
    return cached as T;
  }
  if (!shellInflight.has(key)) {
    const pending = loader()
      .then((mod) => {
        shellModules.set(key, mod);
        shellInflight.delete(key);
        host.requestUpdate?.();
        return mod;
      })
      .catch((error) => {
        shellInflight.delete(key);
        console.error(`[openbot] failed to load shell "${key}"`, error);
        throw error;
      });
    shellInflight.set(key, pending);
  }
  return null;
}

export function preloadShellModule<T>(key: string, loader: () => Promise<T>): void {
  if (shellModules.has(key) || shellInflight.has(key)) {
    return;
  }
  const pending = loader()
    .then((mod) => {
      shellModules.set(key, mod);
      shellInflight.delete(key);
      return mod;
    })
    .catch((error) => {
      shellInflight.delete(key);
      console.error(`[openbot] failed to preload shell "${key}"`, error);
    });
  shellInflight.set(key, pending);
}
