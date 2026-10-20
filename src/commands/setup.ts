import fs from "node:fs/promises";
import JSON5 from "json5";
import { ensureBuiltinStewardAgent } from "../agents/builtin-steward/provision.js";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../agents/workspace.js";
import { type OpenBotConfig, createConfigIO, writeConfigFile } from "../config/config.js";
import { initDataSpaceForConfig } from "../config/data-space.js";
import { formatConfigPath, logConfigUpdated } from "../config/logging.js";
import { resolveSessionTranscriptsDir } from "../config/sessions.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";

async function readConfigFileRaw(configPath: string): Promise<{
  exists: boolean;
  parsed: OpenBotConfig;
}> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { exists: true, parsed: parsed as OpenBotConfig };
    }
    return { exists: true, parsed: {} };
  } catch {
    return { exists: false, parsed: {} };
  }
}

export async function setupCommand(
  opts?: { workspace?: string },
  runtime: RuntimeEnv = defaultRuntime,
) {
  const desiredWorkspace =
    typeof opts?.workspace === "string" && opts.workspace.trim()
      ? opts.workspace.trim()
      : undefined;

  const io = createConfigIO();
  const configPath = io.configPath;
  const existingRaw = await readConfigFileRaw(configPath);
  const cfg = existingRaw.parsed;
  const defaults = cfg.agents?.defaults ?? {};

  const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;

  const next: OpenBotConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        workspace,
      },
    },
    gateway: {
      ...cfg.gateway,
      mode: cfg.gateway?.mode ?? "local",
    },
  };

  // 注册即自带「大白管家」内置 agent（幂等，绝不双 default）。
  const provisioned = ensureBuiltinStewardAgent(next);
  const stewardChanged =
    JSON.stringify(provisioned.agents?.list ?? null) !== JSON.stringify(cfg.agents?.list ?? null);

  // Data Space (data.root) — first-class user-visible data model (Phase 1). Writes the
  // default data.root/schemaVersion and creates the minimal ~/OpenBot tree (local mode).
  const dataInit = initDataSpaceForConfig(provisioned);
  const finalConfig = dataInit.cfg;

  if (
    !existingRaw.exists ||
    defaults.workspace !== workspace ||
    cfg.gateway?.mode !== next.gateway?.mode ||
    stewardChanged ||
    dataInit.changed
  ) {
    await writeConfigFile(finalConfig);
    if (!existingRaw.exists) {
      runtime.log(`Wrote ${formatConfigPath(configPath)}`);
    } else {
      const updates: string[] = [];
      if (defaults.workspace !== workspace) {
        updates.push("set agents.defaults.workspace");
      }
      if (cfg.gateway?.mode !== next.gateway?.mode) {
        updates.push("set gateway.mode");
      }
      if (stewardChanged) {
        updates.push("ensured builtin steward (大白管家)");
      }
      if (dataInit.changed) {
        updates.push("set data.root");
      }
      const suffix = updates.length > 0 ? `(${updates.join(", ")})` : undefined;
      logConfigUpdated(runtime, { path: configPath, suffix });
    }
  } else {
    runtime.log(`Config OK: ${formatConfigPath(configPath)}`);
  }

  const ws = await ensureAgentWorkspace({
    dir: workspace,
    ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap,
  });
  runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);

  if (dataInit.ensured) {
    runtime.log(`Data Space OK: ${shortenHomePath(dataInit.ensured.root)}`);
  }

  const sessionsDir = resolveSessionTranscriptsDir();
  await fs.mkdir(sessionsDir, { recursive: true });
  runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}
