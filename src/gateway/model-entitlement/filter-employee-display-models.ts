/**
 * 员工端「我的可用模型」展示过滤：权益交集之后，只保留员工实际可调用的模型。
 *
 * 排除：
 * - CLI / 开发监督后端（codex-cli、cursor-cli、kiro-cli、claude-cli 等）
 * - 网关未配置 provider、或 provider 下无对应模型条目的平台 id（权益有但调不通）
 *
 * 保留：
 * - `ent/…` 企业自供运行时 id。它们不在 `models.providers` 里，由企业模型运行时解析，
 *   并且进入本列表之前已经过席位授权 ∩ 上界 ∩ 健康资产。
 */

import { isCliProvider, normalizeProviderId } from "../../agents/model-selection.js";
import type { OpenBotConfig } from "../../config/config.js";
import { isEnterpriseRuntimeModelId } from "../enterprise-model/ids.js";
import type { ModelRef } from "./types.js";

/** 明确属于 IDE/CLI 监督通道、不属于员工套餐聊天模型的 provider。 */
const SUPERVISION_CLI_PROVIDERS = new Set([
  "claude-cli",
  "codex-cli",
  "trae-cli",
  "cursor-cli",
  "kiro-cli",
  "gemini-cli",
  "google-gemini-cli",
]);

function splitModelRef(modelId: string): { provider: string; model: string } | null {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return null;
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function providerModelIds(cfg: OpenBotConfig, provider: string): Set<string> {
  const entry = cfg.models?.providers?.[provider];
  const models = entry && typeof entry === "object" ? entry.models : null;
  if (!Array.isArray(models)) {
    return new Set();
  }
  const ids = new Set<string>();
  for (const row of models) {
    const id = row.id.trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/** 是否为 CLI / 开发监督类 provider（不可作为员工套餐聊天模型展示）。 */
export function isSupervisionOrCliProvider(provider: string, cfg?: OpenBotConfig): boolean {
  const normalized = normalizeProviderId(provider);
  if (SUPERVISION_CLI_PROVIDERS.has(normalized)) {
    return true;
  }
  if (normalized.endsWith("-cli")) {
    return true;
  }
  return isCliProvider(provider, cfg);
}

/**
 * 员工端展示用：权益 modelId 中保留网关已配置的平台模型，以及已授权的企业自供模型。
 */
export function filterEmployeeDisplayModelIds(
  modelIds: readonly ModelRef[],
  cfg: OpenBotConfig,
): ModelRef[] {
  const out: ModelRef[] = [];
  const seen = new Set<string>();
  for (const raw of modelIds) {
    const modelId = raw.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    // Enterprise BYOK is callable through the enterprise runtime, not models.providers.
    if (isEnterpriseRuntimeModelId(modelId)) {
      seen.add(modelId);
      out.push(modelId);
      continue;
    }
    const parts = splitModelRef(modelId);
    if (!parts) {
      continue;
    }
    if (isSupervisionOrCliProvider(parts.provider, cfg)) {
      continue;
    }
    const configured = providerModelIds(cfg, parts.provider);
    if (!configured.has(parts.model)) {
      continue;
    }
    seen.add(modelId);
    out.push(modelId);
  }
  return out;
}
