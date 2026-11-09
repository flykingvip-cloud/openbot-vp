import { resolveSandboxContext } from "../../../agents/sandbox.js";
import { grantAccountComputerBrowserTool } from "../../../agents/sandbox/account-computer-browser-routing.js";
import { tryAttachRunningAccountComputerBrowser } from "../../../agents/sandbox/account-computer-running-attach.js";
import { resolveEmbeddedSandboxAccount } from "../../../agents/sandbox/account-scope.js";
import { resolveEmbeddedRunSandboxContextParams } from "../../../agents/sandbox/account-worker-embedded.js";
import { resolveSandboxConfigForAgent } from "../../../agents/sandbox/config.js";

/** Resolve the existing sandbox and attach only an already running account browser. */
export async function resolveAttemptSandbox(
  params: Parameters<typeof resolveEmbeddedRunSandboxContextParams>[0] & { sessionId: string },
  resolvedWorkspace: string,
) {
  const sandboxSessionKey = params.sessionKey?.trim() || params.sessionId;
  let sandbox = await resolveSandboxContext(
    await resolveEmbeddedRunSandboxContextParams({
      config: params.config,
      sessionKey: sandboxSessionKey,
      workspaceDir: resolvedWorkspace,
      agentId: params.agentId,
      gatewayClientUser: params.gatewayClientUser,
      gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
      executionIdentity: params.executionIdentity,
    }),
  );
  // personal_local + sandbox.mode=off: still attach browser to RUNNING 云电脑
  // so 电脑 tab and agent browser are the same shared Chromium (#423).
  if (!sandbox?.accountComputerBrowser) {
    const account = resolveEmbeddedSandboxAccount({
      agentId: params.agentId,
      gatewayClientUser: params.gatewayClientUser,
      gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
      executionIdentity: params.executionIdentity,
    });
    const platformUserId =
      account?.userId ||
      params.gatewayClientPlatformUserId?.trim() ||
      params.executionIdentity?.platformUserId?.trim() ||
      "";
    if (platformUserId && !platformUserId.includes("@")) {
      const attached = await tryAttachRunningAccountComputerBrowser({
        tenantId: account?.tenantId,
        userId: platformUserId,
        config: params.config,
      });
      if (attached) {
        const sandboxCfg = resolveSandboxConfigForAgent(params.config, params.agentId);
        sandbox = {
          enabled: false,
          sessionKey: sandboxSessionKey,
          workspaceDir: resolvedWorkspace,
          agentWorkspaceDir: resolvedWorkspace,
          workspaceAccess: "rw",
          containerName: attached.containerName,
          containerWorkdir: resolvedWorkspace,
          docker: sandboxCfg.docker,
          tools: grantAccountComputerBrowserTool(sandboxCfg.tools),
          browserAllowHostControl: false,
          browser: attached,
          accountComputerBrowser: true,
        };
      }
    }
  }
  return sandbox;
}
