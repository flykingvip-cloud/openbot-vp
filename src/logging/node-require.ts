export function resolveNodeRequireFromMeta(
  metaUrl: string,
): ((id: string) => NodeJS.Require) | null {
  // Browsers have no `process` binding. A bare read throws
  // "process is not defined" when the Control UI evaluates this module
  // (zh-CN locale load pulls logging into the main bundle).
  // `globalThis.process` is nullish there and the real process in Node.
  const getBuiltinModule = (
    globalThis.process as
      | (NodeJS.Process & {
          getBuiltinModule?: (id: string) => unknown;
        })
      | undefined
  )?.getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }
  try {
    const moduleNamespace = getBuiltinModule("module") as {
      createRequire?: (id: string) => NodeJS.Require;
    };
    const createRequire =
      typeof moduleNamespace.createRequire === "function" ? moduleNamespace.createRequire : null;
    return createRequire ? createRequire(metaUrl) : null;
  } catch {
    return null;
  }
}
