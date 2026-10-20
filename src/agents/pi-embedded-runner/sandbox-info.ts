import type { ExecElevatedDefaults } from "../bash-tools.js";
import type { resolveSandboxContext } from "../sandbox.js";
import type { EmbeddedSandboxInfo } from "./types.js";

export function buildEmbeddedSandboxInfo(
  sandbox?: Awaited<ReturnType<typeof resolveSandboxContext>>,
  execElevated?: ExecElevatedDefaults,
): EmbeddedSandboxInfo | undefined {
  if (!sandbox?.enabled) {
    // Attach-only Account Computer: browser control without Docker sandbox runtime.
    if (sandbox?.accountComputerBrowser || sandbox?.accountComputerAttachFailure) {
      return {
        enabled: false,
        browserBridgeUrl: sandbox.browser?.bridgeUrl,
        browserNoVncUrl: sandbox.browser?.noVncUrl,
        hostBrowserAllowed: false,
        ...(sandbox.accountComputerBrowser ? { accountComputerBrowser: true } : {}),
        ...(sandbox.accountComputerAttachFailure
          ? { accountComputerAttachFailure: sandbox.accountComputerAttachFailure }
          : {}),
      };
    }
    return undefined;
  }
  const elevatedAllowed = Boolean(execElevated?.enabled && execElevated.allowed);
  return {
    enabled: true,
    workspaceDir: sandbox.workspaceDir,
    containerWorkspaceDir: sandbox.containerWorkdir,
    workspaceAccess: sandbox.workspaceAccess,
    agentWorkspaceMount: sandbox.workspaceAccess === "ro" ? "/agent" : undefined,
    browserBridgeUrl: sandbox.browser?.bridgeUrl,
    browserNoVncUrl: sandbox.browser?.noVncUrl,
    hostBrowserAllowed: sandbox.browserAllowHostControl,
    ...(sandbox.accountComputerBrowser ? { accountComputerBrowser: true } : {}),
    ...(sandbox.accountComputerAttachFailure
      ? { accountComputerAttachFailure: sandbox.accountComputerAttachFailure }
      : {}),
    ...(elevatedAllowed
      ? {
          elevated: {
            allowed: true,
            defaultLevel: execElevated?.defaultLevel ?? "off",
          },
        }
      : {}),
  };
}
