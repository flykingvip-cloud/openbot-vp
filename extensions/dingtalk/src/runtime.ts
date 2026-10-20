import type { PluginRuntime } from "openclaw/plugin-sdk/compat";

let runtime: PluginRuntime | null = null;

export function setDingtalkRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getDingtalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized. Plugin must be registered first.");
  }
  return runtime;
}
