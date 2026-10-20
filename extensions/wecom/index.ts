import type { OpenClawPluginApi } from "openclaw/plugin-sdk/wecom";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/wecom";
import { wecomDock, wecomPlugin } from "./src/channel.js";
import { setWecomRuntime } from "./src/runtime.js";

const plugin = {
  id: "wecom",
  name: "WeCom",
  description: "OpenBot WeCom channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWecomRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin, dock: wecomDock });
  },
};

export default plugin;
