import type { AccountMountGuard } from "./account-mounts.js";
import type { SandboxFsBridge } from "./fs-bridge.js";
import type { SandboxDockerConfig } from "./types.docker.js";

export type { SandboxDockerConfig } from "./types.docker.js";

export type SandboxToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type SandboxToolPolicySource = {
  source: "agent" | "global" | "default";
  /**
   * Config key path hint for humans.
   * (Arrays use `agents.list[].…` form.)
   */
  key: string;
};

export type SandboxToolPolicyResolved = {
  allow: string[];
  deny: string[];
  sources: {
    allow: SandboxToolPolicySource;
    deny: SandboxToolPolicySource;
  };
};

export type SandboxWorkspaceAccess = "none" | "ro" | "rw";

export type SandboxBrowserConfig = {
  enabled: boolean;
  image: string;
  containerPrefix: string;
  network: string;
  cdpPort: number;
  cdpSourceRange?: string;
  vncPort: number;
  noVncPort: number;
  headless: boolean;
  enableNoVnc: boolean;
  allowHostControl: boolean;
  autoStart: boolean;
  autoStartTimeoutMs: number;
  binds?: string[];
};

export type SandboxPruneConfig = {
  idleHours: number;
  maxAgeDays: number;
};

export type SandboxScope = "session" | "agent" | "shared" | "account";

export type SandboxAccountIdentity = {
  tenantId: string;
  userId: string;
  agentId: string;
};

export type SandboxConfig = {
  mode: "off" | "non-main" | "all";
  scope: SandboxScope;
  /** Server-derived. Never taken from model or tool parameters. */
  account?: SandboxAccountIdentity;
  /** Server-derived browser binds. Present only for account scope. */
  accountBrowserBinds?: string[];
  /** Final docker `-v` allowlist. Present only for account scope. */
  accountMountGuard?: AccountMountGuard;
  workspaceAccess: SandboxWorkspaceAccess;
  workspaceRoot: string;
  docker: SandboxDockerConfig;
  browser: SandboxBrowserConfig;
  tools: SandboxToolPolicy;
  prune: SandboxPruneConfig;
};

export type SandboxBrowserContext = {
  bridgeUrl: string;
  noVncUrl?: string;
  containerName: string;
};

export type SandboxContext = {
  enabled: boolean;
  sessionKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
  containerName: string;
  containerWorkdir: string;
  docker: SandboxDockerConfig;
  tools: SandboxToolPolicy;
  browserAllowHostControl: boolean;
  browser?: SandboxBrowserContext;
  /**
   * True when this sandbox's browser bridge is the user's Account Computer.
   * Host browser control stays off. The browser tool targets this bridge.
   */
  accountComputerBrowser?: boolean;
  /**
   * Set when a browser container lease exists but the control bridge did not
   * attach (CDP unpublished, container cold). Host browser control stays off.
   */
  accountComputerAttachFailure?: string;
  fsBridge?: SandboxFsBridge;
};

export type SandboxWorkspaceInfo = {
  workspaceDir: string;
  containerWorkdir: string;
};
