/**
 * Plugin loader runtime-proxy helper.
 *
 * Owns the lazy `Proxy<PluginRuntime>` previously inlined in
 * `src/plugins/loader.ts`. Extracted per the
 * `gateway-plugins-monolith-decomposition` spec (Task 3.3). The eventual
 * `load-orchestration.ts` driver (Task 3.5) will be the sole caller; for now,
 * `loader.ts` itself wires this in.
 *
 * Behavior contract (Req 4.5, Req 4.7): the returned proxy delegates every
 * trap to a deferred `createPluginRuntime(...)` call, so the runtime is built
 * exactly once on first property access and never built when no plugin
 * touches it. The trap set (`get`, `set`, `has`, `ownKeys`,
 * `getOwnPropertyDescriptor`, `defineProperty`, `deleteProperty`,
 * `getPrototypeOf`) is identical to the pre-refactor inline proxy.
 */

import { createPluginRuntime, type CreatePluginRuntimeOptions } from "../runtime/index.js";
import type { PluginRuntime } from "../runtime/types.js";

export type CreatePluginRuntimeProxyOptions = {
  runtimeOptions?: CreatePluginRuntimeOptions;
};

/**
 * Build a lazy `Proxy<PluginRuntime>`. The underlying runtime is only
 * constructed when a trap fires for the first time, then memoized for
 * subsequent accesses.
 */
export function createPluginRuntimeProxy(
  options: CreatePluginRuntimeProxyOptions = {},
): PluginRuntime {
  let resolvedRuntime: PluginRuntime | null = null;
  const resolveRuntime = (): PluginRuntime => {
    resolvedRuntime ??= createPluginRuntime(options.runtimeOptions);
    return resolvedRuntime;
  };
  return new Proxy({} as PluginRuntime, {
    get(_target, prop, receiver) {
      return Reflect.get(resolveRuntime(), prop, receiver);
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(resolveRuntime(), prop, value, receiver);
    },
    has(_target, prop) {
      return Reflect.has(resolveRuntime(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(resolveRuntime() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(resolveRuntime() as object, prop);
    },
    defineProperty(_target, prop, attributes) {
      return Reflect.defineProperty(resolveRuntime() as object, prop, attributes);
    },
    deleteProperty(_target, prop) {
      return Reflect.deleteProperty(resolveRuntime() as object, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolveRuntime() as object);
    },
  });
}
