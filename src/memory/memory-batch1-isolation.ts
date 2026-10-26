/**
 * Batch1 O8 isolation helpers — synthetic roots only; never points at real ~/.openbot or ~/OpenBot.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type IsolationLayout = {
  root: string;
  stateDir: string;
  dataRoot: string;
  tenantsRoot: string;
  workspace: string;
  sessionsDir: string;
  collaborationDir: string;
  configPath: string;
};

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function assertPathInsideIsolation(candidate: string, isolationRoot: string): string {
  const resolvedCandidate = real(candidate);
  const resolvedRoot = real(isolationRoot);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `isolation violation: path ${resolvedCandidate} is outside isolation root ${resolvedRoot}`,
    );
  }
  return resolvedCandidate;
}

export function assertNoRealHomeLeak(candidate: string): void {
  const home = process.env.HOME ? real(process.env.HOME) : "";
  const resolved = real(candidate);
  const forbidden = [
    home ? path.join(home, ".openbot") : "",
    home ? path.join(home, "OpenBot") : "",
  ].filter(Boolean);
  for (const root of forbidden) {
    const rel = path.relative(root, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(
        `isolation violation: path ${resolved} resolves under real host root ${root}`,
      );
    }
  }
}

export function createIsolationLayout(prefix = "openbot-mem-batch1-"): IsolationLayout {
  // Resolve symlinks immediately (macOS tmp is often /var -> /private/var).
  const root = real(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "data");
  const tenantsRoot = path.join(root, "tenants");
  const workspace = path.join(root, "workspace-main");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  const collaborationDir = path.join(stateDir, "collaboration-shared", "groups");
  const configPath = path.join(stateDir, "openbot.json");
  for (const dir of [stateDir, dataRoot, tenantsRoot, workspace, sessionsDir, collaborationDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const layout: IsolationLayout = {
    root,
    stateDir,
    dataRoot,
    tenantsRoot,
    workspace,
    sessionsDir,
    collaborationDir,
    configPath,
  };
  for (const value of Object.values(layout)) {
    assertPathInsideIsolation(value, root);
    assertNoRealHomeLeak(value);
  }
  return layout;
}

export type IsolationResolvedPaths = {
  stateDir: string;
  dataRoot: string;
  tenantsRoot: string;
  workspace: string;
  configPath: string;
  canonicalStorePath: string;
  parentOfCanonicalIsSymlink: boolean;
  canonicalExists: boolean;
};

/**
 * Clear env/credentials that could escape isolation, then pin OpenBot roots.
 * Handles "path does not exist yet / parent is symlink" by realpath-ing parents.
 */
export function applyIsolationEnv(layout: IsolationLayout): () => void {
  const previous: Record<string, string | undefined> = {
    OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
    OPENBOT_DATA_ROOT: process.env.OPENBOT_DATA_ROOT,
    OPENCLAW_DATA_ROOT: process.env.OPENCLAW_DATA_ROOT,
    OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
    OPENBOT_DATA_MODE: process.env.OPENBOT_DATA_MODE,
    OPENCLAW_DATA_MODE: process.env.OPENCLAW_DATA_MODE,
    OPENBOT_MULTITENANT: process.env.OPENBOT_MULTITENANT,
    OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    OPENBOT_GATEWAY_TOKEN: process.env.OPENBOT_GATEWAY_TOKEN,
    OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN,
    OPENBOT_V1_ROOT_GUARD_SECRET: process.env.OPENBOT_V1_ROOT_GUARD_SECRET,
    OPENBOT_V1_ROOT_GUARD_TOKEN: process.env.OPENBOT_V1_ROOT_GUARD_TOKEN,
    HOME: process.env.HOME,
  };
  // Clear credential / config overrides that could leak outside isolation.
  for (const key of [
    "OPENCLAW_DATA_ROOT",
    "OPENCLAW_DATA_MODE",
    "OPENBOT_CONFIG_PATH",
    "OPENCLAW_CONFIG_PATH",
    "OPENBOT_GATEWAY_TOKEN",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENBOT_V1_ROOT_GUARD_SECRET",
    "OPENBOT_V1_ROOT_GUARD_TOKEN",
  ]) {
    delete process.env[key];
  }
  process.env.OPENBOT_STATE_DIR = assertPathInsideIsolation(layout.stateDir, layout.root);
  process.env.OPENBOT_DATA_ROOT = assertPathInsideIsolation(layout.dataRoot, layout.root);
  process.env.OPENBOT_TENANTS_ROOT = assertPathInsideIsolation(layout.tenantsRoot, layout.root);
  process.env.OPENBOT_DATA_MODE = "local";
  process.env.OPENBOT_MULTITENANT = "0";
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

export function resolveIsolationStoragePaths(layout: IsolationLayout): IsolationResolvedPaths {
  const canonicalStorePath = path.join(layout.dataRoot, ".meta", "cogniweave", "canonical.sqlite");
  const parent = path.dirname(canonicalStorePath);
  let parentOfCanonicalIsSymlink = false;
  try {
    // Path may not exist yet — inspect nearest existing ancestor.
    let cursor = parent;
    while (!fs.existsSync(cursor) && cursor !== path.dirname(cursor)) {
      cursor = path.dirname(cursor);
    }
    parentOfCanonicalIsSymlink = fs.lstatSync(cursor).isSymbolicLink();
  } catch {
    parentOfCanonicalIsSymlink = false;
  }
  const resolved: IsolationResolvedPaths = {
    stateDir: assertPathInsideIsolation(layout.stateDir, layout.root),
    dataRoot: assertPathInsideIsolation(layout.dataRoot, layout.root),
    tenantsRoot: assertPathInsideIsolation(layout.tenantsRoot, layout.root),
    workspace: assertPathInsideIsolation(layout.workspace, layout.root),
    configPath: assertPathInsideIsolation(layout.configPath, layout.root),
    canonicalStorePath: assertPathInsideIsolation(canonicalStorePath, layout.root),
    parentOfCanonicalIsSymlink,
    canonicalExists: fs.existsSync(canonicalStorePath),
  };
  for (const value of [
    resolved.stateDir,
    resolved.dataRoot,
    resolved.tenantsRoot,
    resolved.workspace,
    resolved.configPath,
    resolved.canonicalStorePath,
  ]) {
    assertNoRealHomeLeak(value);
  }
  return resolved;
}

export function writeIsolationConfig(
  layout: IsolationLayout,
  overrides?: Record<string, unknown>,
): void {
  const cfg = {
    data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
    memory: {
      backend: "cogniweave",
      cogniweave: {
        mode: "embedded",
        writeSync: "sync",
        cloudSync: { enabled: false },
      },
    },
    agents: {
      defaults: {
        workspace: layout.workspace,
        memorySearch: { enabled: true },
      },
      list: [{ id: "main", default: true, workspace: layout.workspace }],
    },
    ...overrides,
  };
  fs.writeFileSync(layout.configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  assertPathInsideIsolation(layout.configPath, layout.root);
}
