/** Captured data used by prompt rendering; no source access or execution authority. */
export type ThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive";
export type ReasoningLevel = "off" | "on" | "stream";
export type ResolvedTimeFormat = "12" | "24";
export type EmbeddedContextFile = { path: string; content: string };
export type EmbeddedSandboxInfo = {
  enabled: boolean;
  workspaceDir?: string;
  containerWorkspaceDir?: string;
  workspaceAccess?: "none" | "ro" | "rw";
  agentWorkspaceMount?: string;
  browserBridgeUrl?: string;
  browserNoVncUrl?: string;
  hostBrowserAllowed?: boolean;
  /** Account Computer control bridge is attached. Host browser stays blocked. */
  accountComputerBrowser?: boolean;
  /**
   * Browser lease exists, control bridge is not ready. Prompt a retry.
   * Do not treat this as a host-browser block.
   */
  accountComputerAttachFailure?: string;
  elevated?: {
    allowed: boolean;
    defaultLevel: "on" | "off" | "ask" | "full";
  };
};
