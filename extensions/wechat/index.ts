import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/compat";
import { setWechatPersonalInboundHandler } from "../../src/gateway/user-operational-identity-wechat/inbound-handler.js";
import { wechatDock, wechatPlugin } from "./src/channel.js";
import { handleWechatPersonalInboundEvent } from "./src/inbound.js";
import { setWechatRuntime } from "./src/runtime.js";

const plugin = {
  id: "wechat",
  name: "WeChat",
  description: "OpenBot WeChat personal channel plugin (微信)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWechatRuntime(api.runtime);
    setWechatPersonalInboundHandler(handleWechatPersonalInboundEvent);
    api.registerChannel({ plugin: wechatPlugin, dock: wechatDock });
  },
};

export default plugin;
