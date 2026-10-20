/**
 * Server-derived sandbox mounts for one account (v4.1 §6).
 *
 * Exec sees only the current agent workspace and artifacts (rw) plus optional
 * shared skills/canvas (ro). The browser container sees the account browser
 * profile and the user-level artifacts root. Model-supplied binds are not used.
 *
 * P0 isolates the account execution environment. It does not claim that a
 * compromised Gateway process stays inside one account.
 */
import path from "node:path";

export type AccountMountAccess = "ro" | "rw";

export type AccountMount = {
  hostPath: string;
  containerPath: string;
  access: AccountMountAccess;
};

export type AccountMountPlan = {
  exec: AccountMount[];
  browser: AccountMount[];
};

/** Host bind target for the account agent workspace (Account Computer / account-worker). */
export const ACCOUNT_EXEC_WORKSPACE = "/account/workspace";
const EXEC_WORKSPACE = ACCOUNT_EXEC_WORKSPACE;
const EXEC_ARTIFACTS = "/account/artifacts";
const EXEC_SKILLS = "/account/skills";
const EXEC_CANVAS = "/account/canvas";
export const ACCOUNT_BROWSER_CONTAINER_DIR = "/account/browser";
const BROWSER_PROFILE = ACCOUNT_BROWSER_CONTAINER_DIR;
const BROWSER_ARTIFACTS = "/account/artifacts";

export type AccountMountGuard = {
  execAllow: AccountMount[];
  browserAllow: AccountMount[];
  tenantsRoot: string;
  userRoot: string;
  credentialDir: string;
  configDir: string;
  agentId: string;
  dataRoot: string;
  browserProfileDir: string;
};

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function formatAccountDockerBind(mount: AccountMount): string {
  return `${path.resolve(mount.hostPath)}:${mount.containerPath}:${mount.access}`;
}

export function buildAccountSandboxMountPlan(params: {
  workspaceDir: string;
  artifactsDir: string;
  browserProfileDir: string;
  /**
   * Download directory mounted into the shared Account Computer browser.
   * One per user. When omitted, the browser mounts `artifactsDir` (single-agent callers).
   */
  browserArtifactsDir?: string;
  sharedSkillsDir?: string;
  sharedCanvasDir?: string;
}): AccountMountPlan {
  const exec: AccountMount[] = [
    { hostPath: params.workspaceDir, containerPath: EXEC_WORKSPACE, access: "rw" },
    { hostPath: params.artifactsDir, containerPath: EXEC_ARTIFACTS, access: "rw" },
  ];
  if (params.sharedSkillsDir?.trim()) {
    exec.push({
      hostPath: params.sharedSkillsDir,
      containerPath: EXEC_SKILLS,
      access: "ro",
    });
  }
  if (params.sharedCanvasDir?.trim()) {
    exec.push({
      hostPath: params.sharedCanvasDir,
      containerPath: EXEC_CANVAS,
      access: "ro",
    });
  }
  return {
    exec,
    browser: [
      { hostPath: params.browserProfileDir, containerPath: BROWSER_PROFILE, access: "rw" },
      {
        hostPath: params.browserArtifactsDir?.trim() || params.artifactsDir,
        containerPath: BROWSER_ARTIFACTS,
        access: "rw",
      },
    ],
  };
}

export function parseAccountDockerBind(bind: string): {
  hostPath: string;
  containerPath: string;
  access: AccountMountAccess;
} {
  const parts = bind.split(":");
  if (parts.length < 2) {
    throw new Error("Account sandbox bind must be host:container[:mode].");
  }
  const mode = parts[parts.length - 1];
  if (mode === "ro" || mode === "rw") {
    if (parts.length < 3) {
      throw new Error("Account sandbox bind must be host:container[:mode].");
    }
    return {
      hostPath: parts.slice(0, -2).join(":"),
      containerPath: parts[parts.length - 2] ?? "",
      access: mode,
    };
  }
  return {
    hostPath: parts.slice(0, -1).join(":"),
    containerPath: mode,
    access: "rw",
  };
}

/** `-v` / `--volume` values from a docker create argv, including workspace mounts. */
export function collectDockerVolumeBinds(args: string[]): string[] {
  const binds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if ((flag === "-v" || flag === "--volume") && typeof args[i + 1] === "string") {
      binds.push(args[i + 1] ?? "");
      i += 1;
    }
  }
  return binds;
}

function isAgentCredentialTree(hostPath: string): boolean {
  const parts = path.resolve(hostPath).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length - 3; i += 1) {
    if (parts[i] === "state" && parts[i + 1] === "agents" && parts[i + 3] === "agent") {
      return true;
    }
  }
  return false;
}

function isOtherAgentTree(hostPath: string, dataRoot: string, agentId: string): boolean {
  const agentsRoot = path.join(path.resolve(dataRoot), "agents");
  const host = path.resolve(hostPath);
  if (!isInside(host, agentsRoot) || samePath(host, agentsRoot)) {
    return false;
  }
  const owner = path.relative(agentsRoot, host).split(path.sep)[0];
  return Boolean(owner && owner !== "." && owner !== agentId);
}

function isDockerSocket(hostPath: string): boolean {
  const base = path.basename(path.resolve(hostPath));
  return base === "docker.sock" || hostPath.includes(`${path.sep}docker.sock`);
}

/**
 * Reject binds that escape the server-derived allowlist.
 * `userRoot` is `users/<uid>` and must not be mounted as a whole.
 */
export function assertAccountMountsAllowed(params: {
  binds: string[];
  allow: AccountMount[];
  tenantsRoot: string;
  userRoot: string;
  credentialDir: string;
  configDir: string;
  otherUserRoots?: string[];
  /** Current agent. Used to reject a same-user other-agent workspace. */
  agentId?: string;
  /** Account OpenBot data root (`users/<uid>/OpenBot`). */
  dataRoot?: string;
}): void {
  const allow = params.allow.map((mount) => ({
    ...mount,
    hostPath: path.resolve(mount.hostPath),
  }));
  const tenantsRoot = path.resolve(params.tenantsRoot);
  const userRoot = path.resolve(params.userRoot);
  const ownerUid = path.basename(userRoot);
  const ownTenant = path.relative(tenantsRoot, userRoot).split(path.sep)[0];
  for (const bind of params.binds) {
    const parsed = parseAccountDockerBind(bind);
    const host = path.resolve(parsed.hostPath);
    if (isDockerSocket(host)) {
      throw new Error("Account sandbox refuses a docker.sock mount.");
    }
    if (
      samePath(host, tenantsRoot) ||
      isInside(tenantsRoot, host) ||
      samePath(host, params.configDir) ||
      samePath(host, userRoot)
    ) {
      throw new Error("Account sandbox refuses tenants, config, or whole-user mounts.");
    }
    if (isInside(host, tenantsRoot)) {
      const tenantSeg = path.relative(tenantsRoot, host).split(path.sep)[0];
      if (tenantSeg && ownTenant && tenantSeg !== ".." && tenantSeg !== ownTenant) {
        throw new Error("Account sandbox refuses another user's tree.");
      }
    }
    const hostParts = host.split(path.sep);
    const usersIdx = hostParts.lastIndexOf("users");
    const boundUid = usersIdx >= 0 ? hostParts[usersIdx + 1] : undefined;
    if (boundUid && ownerUid && boundUid !== ownerUid) {
      throw new Error("Account sandbox refuses another user's tree.");
    }
    if (isInside(host, params.credentialDir) || isAgentCredentialTree(host)) {
      throw new Error("Account sandbox refuses the agent credential directory.");
    }
    for (const other of params.otherUserRoots ?? []) {
      if (isInside(host, other)) {
        throw new Error("Account sandbox refuses another user's tree.");
      }
    }
    if (
      params.dataRoot &&
      params.agentId &&
      isOtherAgentTree(host, params.dataRoot, params.agentId)
    ) {
      throw new Error("Account sandbox refuses another agent's workspace.");
    }
    const match = allow.find((mount) => samePath(mount.hostPath, host));
    if (!match) {
      throw new Error("Account sandbox bind is not in the server-derived allowlist.");
    }
    if (match.access === "ro" && parsed.access !== "ro") {
      throw new Error("Shared skills and canvas mounts must be read-only.");
    }
    if (match.access === "rw" && parsed.access === "ro") {
      throw new Error("Account workspace and artifacts mounts must be writable.");
    }
  }
}
