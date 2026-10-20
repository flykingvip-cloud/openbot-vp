import { createPluginRuntimeStore } from "openclaw/plugin-sdk/wecom";
import type { PluginRuntime } from "openclaw/plugin-sdk/wecom";

const { setRuntime: setWecomRuntime, getRuntime: getWecomRuntime } =
  createPluginRuntimeStore<PluginRuntime>("WeCom runtime not initialized");

export { getWecomRuntime, setWecomRuntime };
