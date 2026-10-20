/**
 * Daibai Ownership Preflight（决策 H）。
 *
 * 大白代办 robot-skills.* 等改目标机器人的写动作时，**必须**先校验目标 agentId 属于
 * 「当前用户可见/可管的机器人集合」，禁止任意 agentId 透传（现状 robot-skills handler 不看 client 身份）。
 *
 * 数据源优先级（spec 决策 H）：
 *  (1) employee 域：seat 资产库 `EnterpriseSeatAssetsStore` 的 `agent` 类资产 —— **扩展点**
 *      （需 tenant/seat 受信上下文 + 异步加载；本期未接入，留待企业 seat 维度收窄）。
 *  (2) 回退：`listAgentIds(cfg)` —— 本安装配置中定义的 agent 集合。
 *  (3) 一期默认：仅「当前工作台选中 agent」（前端传入），服务端用 (1)/(2) 复核归属。
 *
 * 本期实现 (2)+(3)：可管集合 = 配置中的 agentIds；目标 agentId 必须在其中，杜绝指向不存在/越界 agent。
 */

import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";

/** 解析当前用户可管的 agentId 集合（规范化）。 */
export function resolveManageableAgentIds(cfg?: OpenBotConfig): string[] {
  const config = cfg ?? loadConfig();
  return listAgentIds(config).map((id) => normalizeAgentId(id));
}

export class StewardOwnershipError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent not manageable by current user: ${agentId}`);
    this.name = "StewardOwnershipError";
  }
}

/**
 * 校验目标 agentId 是否在可管集合内。
 * @throws StewardOwnershipError 当 agentId 缺失或不可管时。
 */
export function assertAgentManageable(agentId: unknown, cfg?: OpenBotConfig): string {
  if (typeof agentId !== "string" || !agentId.trim()) {
    throw new StewardOwnershipError(String(agentId));
  }
  const normalized = normalizeAgentId(agentId);
  const manageable = resolveManageableAgentIds(cfg);
  if (!manageable.includes(normalized)) {
    throw new StewardOwnershipError(agentId);
  }
  return normalized;
}
