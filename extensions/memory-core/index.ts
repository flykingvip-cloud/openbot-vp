import type { OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/memory-core";

const memoryCorePlugin = {
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerTool(
      (ctx) => {
        // Continuity authz (members.json) needs an authenticated human id.
        // Prefer the gateway session user; fall back to trusted inbound sender.
        const authenticatedUserId =
          ctx.gatewayClientUser?.trim() || ctx.requesterSenderId?.trim() || undefined;
        // Trusted security mode must be explicit (see #156 B3). Map pinned
        // enterprise/employee session domains to managed_enterprise; do not
        // infer managed from tenant presence alone.
        const sessionDomain = ctx.gatewayClientSessionDomain;
        const securityProfile =
          sessionDomain === "enterprise" || sessionDomain === "employee"
            ? ("managed_enterprise" as const)
            : undefined;
        const memorySearchTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
          authenticatedUserId,
          securityProfile,
          gatewayClientUser: ctx.gatewayClientUser,
          gatewayClientSessionDomain: ctx.gatewayClientSessionDomain,
        });
        const memoryGetTool = api.runtime.tools.createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
          authenticatedUserId,
          securityProfile,
          gatewayClientUser: ctx.gatewayClientUser,
          gatewayClientSessionDomain: ctx.gatewayClientSessionDomain,
        });
        if (!memorySearchTool || !memoryGetTool) {
          return null;
        }
        return [memorySearchTool, memoryGetTool];
      },
      { names: ["memory_search", "memory_get"] },
    );

    api.registerCli(
      ({ program }) => {
        api.runtime.tools.registerMemoryCli(program);
      },
      { commands: ["memory"] },
    );
  },
};

export default memoryCorePlugin;
