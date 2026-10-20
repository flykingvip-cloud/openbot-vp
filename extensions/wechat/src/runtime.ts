import type { PluginRuntime } from "openclaw/plugin-sdk/compat";

let runtime: PluginRuntime | null = null;

export function setWechatRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getWechatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WeChat runtime not initialized. Plugin must be registered first.");
  }
  return runtime;
}
