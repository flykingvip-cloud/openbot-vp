/**
 * Builtin Steward — 系统自带注入（provisioning）。
 *
 * 用户注册/初始化时，确保员工端自带「大白管家」内置 agent 条目。
 *
 * 关键策略（见 .kiro/specs/daibai-super-steward，决策 A / A2）：
 * - **幂等**：已存在大白条目时仅补缺失字段，绝不覆盖用户自定义。
 * - **绝不双 default**：调用前后 `default===true` 的条目数量绝不增加。
 *   - 无任何默认 agent 时（含空配置 / 仅 main 无 default）→ 把大白设为默认；
 *   - 已存在其它默认 agent 时 → 大白条目**不带** default，且原默认保持不变（决策 A2：
 *     `defaultAgentId` 可以不是大白，大白入口不依赖 default 标志）。
 * - **多 agent 安全**：只注入/补字段，绝不删除或改写他人 agent。
 * - **标配 skills**：不在此写入 `agents.list[].skills` 白名单（省略 = 全部 eligible）。
 *   大白标配技能（如 `user-guidance-protocol`、`execution-discipline`）以 bundled
 *   发布，并在 `resolveAgentSkillsFilter` 中于白名单模式下强制保留；勿依赖 always 注入。
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { AgentConfig } from "../../config/types.agents.js";
import {
  BUILTIN_STEWARD_AGENT_ID,
  BUILTIN_STEWARD_AVATAR,
  BUILTIN_STEWARD_EMOJI,
  BUILTIN_STEWARD_NAME,
  isBuiltinStewardAgent,
} from "./identity.js";

/** 大白内置身份预设（注入新条目或补缺失字段时使用）。 */
function buildStewardIdentityPreset(): NonNullable<AgentConfig["identity"]> {
  return {
    name: BUILTIN_STEWARD_NAME,
    emoji: BUILTIN_STEWARD_EMOJI,
    avatar: BUILTIN_STEWARD_AVATAR,
  };
}

/** 大白记忆预设：默认启用向量记忆（缺 key 时由 backend 自动降级，不阻断启动）。 */
function buildStewardMemorySearchPreset(): NonNullable<AgentConfig["memorySearch"]> {
  return { enabled: true };
}

/** Steward-only tool grants (not in default profiles). */
const STEWARD_TOOL_IDS = [
  "knowledge_source",
  "schedule",
  "meeting",
  "user_operational_identity",
  "data_capability",
  "diagnose",
  "evolution_perception",
  "confirm_diagnose_prescription",
  "confirm_diagnose_evolution",
  "conversation_send",
  "tenant_user_notify",
] as const;

/**
 * Ensure builtin steward can call schedule/meeting (and other steward tools) via alsoAllow.
 * Additive only: never removes user deny / existing alsoAllow entries.
 */
function ensureStewardToolsAlsoAllow(entry: AgentConfig): AgentConfig {
  const tools = entry.tools ?? {};
  const alsoAllow = Array.isArray(tools.alsoAllow) ? [...tools.alsoAllow] : [];
  const deny = Array.isArray(tools.deny) ? tools.deny : [];
  const additions = STEWARD_TOOL_IDS.filter(
    (toolId) => !deny.includes(toolId) && !alsoAllow.includes(toolId),
  );
  if (additions.length === 0) {
    return entry;
  }
  return {
    ...entry,
    tools: {
      ...tools,
      alsoAllow: [...alsoAllow, ...additions],
    },
  };
}

/** 仅补 identity 缺失子字段，保留用户已自定义的值。 */
function fillMissingIdentity(
  existing: AgentConfig["identity"],
): NonNullable<AgentConfig["identity"]> {
  const preset = buildStewardIdentityPreset();
  if (!existing) {
    return preset;
  }
  return {
    ...existing,
    name: existing.name ?? preset.name,
    emoji: existing.emoji ?? preset.emoji,
    avatar: existing.avatar ?? preset.avatar,
  };
}

/**
 * 确保配置中存在内置大白 agent 条目（幂等）。返回新的配置对象（不修改入参）。
 */
export function ensureBuiltinStewardAgent(cfg: OpenBotConfig): OpenBotConfig {
  const sourceList = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const entries: AgentConfig[] = sourceList.map((entry) => ({ ...entry }));

  const stewardIndex = entries.findIndex((entry) => isBuiltinStewardAgent(entry?.id));
  // 是否已存在任意默认 agent（含大白自身）。决定「绝不双 default」策略。
  const hasAnyDefault = entries.some((entry) => entry?.default === true);

  if (stewardIndex === -1) {
    // 注入新的大白条目。无任何默认 → 大白设为默认；否则不带 default（不抢占）。
    const stewardEntry = ensureStewardToolsAlsoAllow({
      id: BUILTIN_STEWARD_AGENT_ID,
      ...(hasAnyDefault ? {} : { default: true }),
      identity: buildStewardIdentityPreset(),
      memorySearch: buildStewardMemorySearchPreset(),
    });
    entries.push(stewardEntry);
  } else {
    // 已存在 → 仅补缺失字段，绝不覆盖用户自定义。
    const existing = entries[stewardIndex];
    let patched: AgentConfig = {
      ...existing,
      identity: fillMissingIdentity(existing.identity),
      memorySearch: existing.memorySearch ?? buildStewardMemorySearchPreset(),
    };
    // 无任何默认且大白存在 → 补默认到大白（case c）；已有默认则保持不变（绝不双 default）。
    if (!hasAnyDefault) {
      patched.default = true;
    }
    patched = ensureStewardToolsAlsoAllow(patched);
    entries[stewardIndex] = patched;
  }

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: entries,
    },
  };
}

/**
 * 网关启动兜底：确保存量配置也自带大白条目（持久化一次，幂等）。
 *
 * 对齐既有启动迁移范式（`maybeSeedControlUiAllowedOriginsAtStartup`）：仅当 provisioning
 * 改变了 `agents.list` 时才落盘一次，使所有 `loadConfig()` 调用方都能看到大白。
 * 幂等：后续启动若无变更则不写盘。
 */
export async function maybeProvisionBuiltinStewardAtStartup(params: {
  config: OpenBotConfig;
  writeConfig: (cfg: OpenBotConfig) => Promise<void>;
  log?: { info?: (message: string) => void };
}): Promise<OpenBotConfig> {
  const provisioned = ensureBuiltinStewardAgent(params.config);
  const before = JSON.stringify(params.config.agents?.list ?? null);
  const after = JSON.stringify(provisioned.agents?.list ?? null);
  if (before === after) {
    return params.config;
  }
  await params.writeConfig(provisioned);
  params.log?.info?.("agent provisioning: ensured builtin steward (大白管家) entry");
  return provisioned;
}
