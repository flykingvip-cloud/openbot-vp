import { createPluginRuntimeStore } from "openclaw/plugin-sdk/media-monitor";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";

export const { setRuntime: setMediaMonitorRuntime, getRuntime: getMediaMonitorRuntime } =
  createPluginRuntimeStore<OpenClawPluginApi["runtime"]>("Media Monitor runtime not initialized");
