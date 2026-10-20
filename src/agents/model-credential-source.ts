/**
 * 模型凭证来源收敛（model-entitlement-chain P4，任务 15）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.1 / §6.4, R1.1, Property 6）。
 *
 * 现状（legacy）：`resolveApiKeyForProvider` 的解析链为
 * `profile → aws → auth-profiles → env → inline apiKey → secrets`，其中**环境变量会遮蔽
 * 内联 apiKey**，导致「同一 provider 多套 key 互相覆盖、运行时取到失效 key」（§3.1）。
 *
 * P4「收敛」：把运行时 key 收敛到**平台目录配置的单一凭证**（即 `models.providers.<provider>`
 * 的内联 apiKey / SecretRef——P1/P2 阶段平台目录的事实载体）。`credentials.mode="catalog"`
 * 时该凭证为**唯一权威来源**，优先于 auth-profiles 与 ambient env（消除残留 profile / 失效 env
 * 遮蔽已配置 key 的故障），且解析结果可追溯到一个 `credentialRef`（Property 6）。仅显式 profileId
 * 请求与 aws-sdk 鉴权模式在其之上。
 *
 * 安全切口（§1.5 / §6.4）：
 * - 默认 `legacy`，**行为零变化**；`catalog` 为显式 opt-in。
 * - `catalog` 模式下若该 provider **未配置**目录凭证 → 回退到 legacy 链（回退开关恒在）。
 * - 不删除任何既有来源；只在 catalog 模式调整**优先级**（内联优先于 env）。
 *
 * 本模块只含纯函数 / 类型，**不** import model-auth（避免循环依赖）；实际凭证解析
 * `resolveProviderCredentialSource` 由 model-auth.ts 提供（凭证解析权威所在）。
 */

import type { OpenBotConfig } from "../config/types.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { secretRefKey } from "../secrets/ref-contract.js";
import { resolveSecretRefValues } from "../secrets/resolve.js";
import { getRawProviderApiKeyInput, resolveUsableCustomProviderApiKey } from "./model-auth.js";
import { normalizeProviderId } from "./model-selection.js";

export type ModelCredentialsMode = "legacy" | "catalog";

export function resolveModelCredentialsMode(cfg: OpenBotConfig | undefined): ModelCredentialsMode {
  const mode = cfg?.gateway?.platform?.models?.credentials?.mode;
  return mode === "catalog" ? "catalog" : "legacy";
}

/**
 * 单一权威凭证解析结果。`credentialRef` 是确定性、可追溯的来源标识。
 */
export type ResolvedCredentialSource = {
  apiKey: string;
  /** 人类可读来源（透传 model-auth 的 source）。 */
  source: string;
  /** 确定性、唯一的凭证引用标识（Property 6 可追溯性）。 */
  credentialRef: string;
};

/**
 * 由 provider + 解析 source 推导确定性 credentialRef：
 * - source 含 "marker"（内联值是 env marker）→ `env:<source>`
 * - 否则（内联字面 key）→ `config:models.providers.<provider>.apiKey`
 *
 * 纯函数：保证「同一 provider + 同一 source → 同一 credentialRef」（Property 6）。
 */
export function deriveCredentialRef(normalizedProvider: string, source: string): string {
  return source.includes("marker")
    ? `env:${source}`
    : `config:models.providers.${normalizedProvider}.apiKey`;
}

/**
 * 解析某 provider 的平台目录凭证（单一权威来源，model-entitlement-chain P4 任务 15）。
 *
 * 复用 `resolveUsableCustomProviderApiKey`（内联字面 / env-marker 间接）——这正是平台目录
 * 在 P1/P2 的事实载体。返回 null 表示该 provider **未配置**目录凭证（catalog 模式回退 legacy）。
 * 结果带确定性 `credentialRef`，保证「同一 provider → 唯一可追溯凭证」（Property 6）。
 *
 * 注：与 model-auth 互为调用方（call-time 循环，无 module-init 依赖），ESM 下安全。
 */
export function resolveProviderCredentialSource(params: {
  cfg: OpenBotConfig | undefined;
  provider: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedCredentialSource | null {
  const resolved = resolveUsableCustomProviderApiKey({
    cfg: params.cfg,
    provider: params.provider,
    ...(params.env ? { env: params.env } : {}),
  });
  if (!resolved) {
    return null;
  }
  return {
    apiKey: resolved.apiKey,
    source: resolved.source,
    credentialRef: deriveCredentialRef(normalizeProviderId(params.provider), resolved.source),
  };
}

/**
 * 平台目录单一权威凭证解析（catalog 模式，async）——覆盖**三种目录凭证形态**：
 * 1. `SecretRef` 对象 / `$REF` 字符串：经 secrets runtime 解析，`credentialRef = secret:<source>:<provider>:<id>`。
 * 2. 内联字面 key：`credentialRef = config:models.providers.<provider>.apiKey`。
 * 3. 已知 env marker：`credentialRef = env:<source label>`。
 *
 * 返回 null = 该 provider **未配置**目录凭证（catalog 模式据此回退 legacy 链，回退开关恒在）。
 * 与同步 `resolveProviderCredentialSource` 的区别：本函数额外闭环 SecretRef 形态，并显式
 * 产出可追溯 `credentialRef`，供运行时主链（`resolveApiKeyForProvider`）带出（P4 gate：单源可追溯）。
 */
export async function resolveCatalogProviderCredential(params: {
  cfg: OpenBotConfig | undefined;
  provider: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ResolvedCredentialSource | null> {
  const raw = getRawProviderApiKeyInput(params.cfg, params.provider);
  // 形态 1：SecretRef（对象或 `$REF` 字符串）。直接解析并追溯到 SecretRef。
  const { ref } = resolveSecretInputRef({
    value: raw,
    defaults: params.cfg?.secrets?.defaults,
  });
  if (ref) {
    if (!params.cfg) {
      return null;
    }
    try {
      const resolvedMap = await resolveSecretRefValues([ref], {
        config: params.cfg,
        env: params.env ?? process.env,
      });
      const value = resolvedMap.get(secretRefKey(ref));
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) {
        return null;
      }
      return {
        apiKey: trimmed,
        source: `models.json (SecretRef ${secretRefKey(ref)})`,
        credentialRef: `secret:${secretRefKey(ref)}`,
      };
    } catch {
      // SecretRef 解析失败 → 视为「未配置目录凭证」，回退 legacy 链。
      return null;
    }
  }
  // 形态 2 / 3：内联字面 key 或 env marker，复用同步解析（确定性、可追溯）。
  return resolveProviderCredentialSource({
    cfg: params.cfg,
    provider: params.provider,
    ...(params.env ? { env: params.env } : {}),
  });
}
