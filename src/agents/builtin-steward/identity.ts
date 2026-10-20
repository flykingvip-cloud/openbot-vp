/**
 * Builtin Steward (大白管家) — 系统自带超级管家的身份契约。
 *
 * 大白是用户端唯一的内置 steward 入口。为避免「main」字面量散落在前后端各处，
 * 这里集中定义其 agentId / 展示名 / 默认头像，并提供 `isBuiltinStewardAgent` 判定。
 *
 * 设计要点（见 .kiro/specs/daibai-super-steward）：
 * - 决策 A：大白复用默认 agent id `main`（与现状 UX 壳层、assistant-identity 默认解析一致）。
 * - 决策 A2：大白入口 != seat 默认工作 agent；`defaultAgentId` 可以不是大白。
 *   因此判定**只**认 steward agentId，不依赖 `default` 标志。
 */

import { normalizeAgentId } from "../../routing/session-key.js";

/** 内置大白复用的 agent id（决策 A）。 */
export const BUILTIN_STEWARD_AGENT_ID = "main" as const;

/** 大白对用户展示的名称。 */
export const BUILTIN_STEWARD_NAME = "大白管家" as const;

/** 大白默认头像（首字母/emoji 兜底，遵循 assistant-identity 的短头像约定）。 */
export const BUILTIN_STEWARD_AVATAR = "大" as const;

/** 大白默认 emoji（用于 ack reaction / 头像兜底）。 */
export const BUILTIN_STEWARD_EMOJI = "🐳" as const;

/**
 * 判定给定 agentId 是否为内置大白。
 *
 * 规范化后与 `BUILTIN_STEWARD_AGENT_ID` 比较，容忍大小写/空白差异
 * （与 `resolveDefaultAgentId` / `resolveAssistantIdentity` 的 normalizeAgentId 口径一致）。
 */
export function isBuiltinStewardAgent(agentId: string | null | undefined): boolean {
  if (typeof agentId !== "string" || !agentId.trim()) {
    return false;
  }
  return normalizeAgentId(agentId) === normalizeAgentId(BUILTIN_STEWARD_AGENT_ID);
}

/**
 * 员工端通用向导：确保 agent id 列表包含内置大白（幂等、不改变既有顺序）。
 *
 * 大白是所有新员工进入工作台后的关键向导，不依赖岗位 `defaultAgentAssetIds` 配置。
 */
export function withEmployeeUniversalStewardAgentIds(agentIds: readonly string[]): string[] {
  if (agentIds.some((agentId) => isBuiltinStewardAgent(agentId))) {
    return [...agentIds];
  }
  return [...agentIds, BUILTIN_STEWARD_AGENT_ID];
}
