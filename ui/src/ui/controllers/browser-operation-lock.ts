const localLockTails = new Map<string, Promise<void>>();

async function withLocalExclusiveLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const previous = localLockTails.get(name) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  localLockTails.set(name, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (localLockTails.get(name) === tail) {
      localLockTails.delete(name);
    }
  }
}

/** Serialize a browser operation across tabs, with an in-process fallback for tests. */
export async function withBrowserOperationLock<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Browser operation lock name is required.");
  }
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(normalizedName, { mode: "exclusive" }, () => operation());
  }
  return withLocalExclusiveLock(normalizedName, operation);
}
