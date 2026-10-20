/**
 * Entitlement doctor 体检项（P1，任务 6）。
 *
 * 只读观测，不修改任何配置。两项检测：
 * 1. 同一 provider 多个运行时生效的 key 来源冲突（inline 字面 key 与已设置 env 变量并存）。
 * 2. 租户 entitlement 缺失（已有订阅但无 entitlement 记录，提示需迁移）。
 *
 * 输出结构化结果，由调用方决定如何渲染（CLI warn / log / 忽略）。
 */

import { PROVIDER_ENV_API_KEY_CANDIDATES } from "../../agents/model-auth-env-vars.js";
import { isNonSecretApiKeyMarker } from "../../agents/model-auth-markers.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import type { OpenBotConfig } from "../../config/types.js";
import { listPlans, listPlanVersions } from "../billing/plans-store.js";
import { listActiveSubscriptionTenantIds } from "../billing/subscriptions-store.js";
import { checkResourceCatalogIntegrity } from "../resource-catalog/doctor-checks.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { listEnterpriseModelEntitlements } from "./enterprise-model-entitlement-store.js";
import {
  PLAN_BINDING_VISION_BLOCKER,
  planBindingIncludesVisionModel,
} from "./plan-binding-vision.js";
import { listPlanVersionModelBindings } from "./plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "./resolve-effective-model-set.js";

export type EntitlementDoctorIssue = {
  code:
    | "model_key_conflict"
    | "entitlement_missing"
    | "credential_convergence"
    | "plan_binding_missing"
    | "plan_binding_missing_vision"
    | "plan_binding_orphan"
    | "plan_binding_invalid_catalog"
    | "resource_catalog_missing"
    | "binding_tier_mismatch"
    | "binding_tier_empty_projection";
  severity: "warning" | "info";
  modelId?: string;
  tenantId?: string;
  planId?: string;
  planVersionId?: string;
  message: string;
  hint: string;
};

/**
 * 检测同一 provider 是否存在多个**运行时实际生效**的 key 来源冲突。
 *
 * 与运行时 `model-auth.ts` 的解析口径对齐（关键：不再误用 `secrets.providers`，
 * 那只是 secret provider 的配置，不等于该模型 provider 已有可用 key）：
 * - 内联字面 key：`models.providers.<provider>.apiKey` 且**不是** env marker
 *   （若是 marker，它只是指向某个 env 变量，不构成独立来源）。
 * - 环境变量：该 provider 规范化后在 `PROVIDER_ENV_API_KEY_CANDIDATES` 中登记的
 *   候选变量在 `process.env` 中已设置（这正是 `resolveEnvApiKey` 的实际读取集合）。
 *
 * 仅当「内联字面 key」与「已设置的 env 变量」同时存在时判定冲突——这对应 design §3.1
 * 所述「同一 provider 多套 key 互相覆盖、运行时取到失效 key」的真实故障，避免误报/漏报。
 */
export function checkModelKeyConflicts(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EntitlementDoctorIssue[] {
  const issues: EntitlementDoctorIssue[] = [];
  const providers = (cfg?.models as Record<string, unknown> | undefined)?.providers;
  if (!providers || typeof providers !== "object") {
    return issues;
  }
  for (const [providerName, rawProvider] of Object.entries(providers as Record<string, unknown>)) {
    const provider = rawProvider as Record<string, unknown> | undefined;
    if (!provider) {
      continue;
    }

    const sources: string[] = [];

    // 1. 内联字面 key（排除 env marker：marker 只是指向 env，不是独立来源）。
    const inlineApiKey =
      typeof provider.apiKey === "string" && provider.apiKey.trim() ? provider.apiKey.trim() : "";
    if (inlineApiKey && !isNonSecretApiKeyMarker(inlineApiKey)) {
      sources.push("inline apiKey");
    }

    // 2. 运行时实际读取的 env 候选变量（与 resolveEnvApiKey 对齐）。
    const normalized = normalizeProviderId(providerName);
    const envCandidates = PROVIDER_ENV_API_KEY_CANDIDATES[normalized] ?? [];
    const setEnvVars = envCandidates.filter((name) => env[name]?.trim());
    for (const name of setEnvVars) {
      sources.push(`env ${name}`);
    }

    if (sources.length > 1) {
      // 枚举该 provider 下的 modelIds
      const modelIds = (
        Array.isArray(provider.models)
          ? (provider.models as Array<{ id?: unknown }>)
              .map((m) => (typeof m?.id === "string" ? `${providerName}/${m.id}` : null))
              .filter(Boolean)
          : []
      ) as string[];
      for (const modelId of modelIds.length ? modelIds : [`${providerName}/*`]) {
        issues.push({
          code: "model_key_conflict",
          severity: "warning",
          modelId,
          message: `Model "${modelId}" has multiple usable key sources: ${sources.join(", ")}. Runtime resolves env before inline apiKey (model-auth.ts), so a stale env key can shadow the configured one and cause 401 errors.`,
          hint: `Consolidate to a single key source: keep the inline apiKey in config and unset the env variable(s), or vice versa. See design §6.4.`,
        });
      }
    }
  }
  return issues;
}

/**
 * 按租户核查：存在 active 订阅但无 entitlement 记录的租户（需迁移/下发）。
 * 逐个租户核查，而非「整个 store 为空才告警」——任意租户缺失都会被报出。
 */
export async function checkEntitlementMissing(
  cfg: OpenBotConfig | undefined,
  opts?: { entitlementStorePath?: string; subscriptionsStorePath?: string },
): Promise<EntitlementDoctorIssue[]> {
  const issues: EntitlementDoctorIssue[] = [];
  const modelIds = listConfiguredModelIds(cfg);
  if (modelIds.length === 0) {
    return issues;
  }

  const subscribedTenantIds = await listActiveSubscriptionTenantIds(opts?.subscriptionsStorePath);
  if (subscribedTenantIds.length === 0) {
    return issues;
  }

  const entitlements = await listEnterpriseModelEntitlements(opts?.entitlementStorePath);
  const tenantsWithEntitlement = new Set(
    entitlements.map((e) => canonicalizeTenantId(e.tenantId) ?? e.tenantId),
  );

  for (const tenantId of subscribedTenantIds) {
    const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
    if (!tenantsWithEntitlement.has(canonical)) {
      issues.push({
        code: "entitlement_missing",
        severity: "warning",
        tenantId: canonical,
        message: `Tenant "${canonical}" has an active subscription but no model entitlement record.`,
        hint: `Run model entitlement migration to project plan_version → allowedModelIds for this tenant. Until then, its employee sessions fall back to global model defaults (missing-allow mode).`,
      });
    }
  }
  return issues;
}

/**
 * 平台套餐版本与模型绑定一致性核查（只读）。
 *
 * 检测项：
 * - active/current version 缺 binding
 * - binding 指向不存在的 planVersion（孤儿）
 * - binding 含目录外模型
 */
export async function checkPlanBindingIntegrity(
  cfg: OpenBotConfig | undefined,
  opts?: { plansStorePath?: string; planBindingStorePath?: string },
): Promise<EntitlementDoctorIssue[]> {
  const issues: EntitlementDoctorIssue[] = [];
  const catalog = new Set(listConfiguredModelIds(cfg));
  const plans = await listPlans(opts?.plansStorePath);
  const planVersions = await Promise.all(
    plans.map(async (plan) => ({
      plan,
      versions: await listPlanVersions(plan.id, opts?.plansStorePath),
    })),
  );
  const allVersions = new Map(
    planVersions.flatMap(({ plan, versions }) =>
      versions.map((version) => [version.id, { version, plan }]),
    ),
  );
  const bindings = await listPlanVersionModelBindings(opts?.planBindingStorePath);
  const bindingByVersion = new Map(bindings.map((binding) => [binding.planVersionId, binding]));

  for (const { plan, versions } of planVersions) {
    const activeVersion =
      versions.find((version) => version.status === "active") ??
      versions.find((version) => version.id === plan.currentVersionId) ??
      null;
    if (activeVersion && !bindingByVersion.has(activeVersion.id)) {
      issues.push({
        code: "plan_binding_missing",
        severity: "warning",
        planId: plan.id,
        planVersionId: activeVersion.id,
        message: `Plan "${plan.name}" current version "${activeVersion.id}" has no model binding.`,
        hint: "Create or repair a binding for the current plan version before activation or tenant rollout.",
      });
    }
  }

  for (const binding of bindings) {
    const versionRef = allVersions.get(binding.planVersionId);
    if (!versionRef) {
      issues.push({
        code: "plan_binding_orphan",
        severity: "warning",
        planVersionId: binding.planVersionId,
        message: `Model binding "${binding.planVersionId}" points to a missing plan version.`,
        hint: "Delete the orphan binding or recreate the referenced plan version if it was removed unexpectedly.",
      });
      continue;
    }
    const invalidModelIds = binding.allowedModelIds.filter((modelId) => !catalog.has(modelId));
    if (invalidModelIds.length > 0) {
      issues.push({
        code: "plan_binding_invalid_catalog",
        severity: "warning",
        planId: versionRef.plan.id,
        planVersionId: binding.planVersionId,
        message: `Plan "${versionRef.plan.name}" version "${binding.planVersionId}" contains models outside the active catalog: ${invalidModelIds.join(", ")}.`,
        hint: "Replace or remove catalog-external models from this binding before the version is activated or edited again.",
      });
    }
    if (
      binding.allowedModelIds.length > 0 &&
      invalidModelIds.length === 0 &&
      !(await planBindingIncludesVisionModel(cfg, binding.allowedModelIds))
    ) {
      issues.push({
        code: "plan_binding_missing_vision",
        severity: "warning",
        planId: versionRef.plan.id,
        planVersionId: binding.planVersionId,
        message: `Plan "${versionRef.plan.name}" version "${binding.planVersionId}" has no vision-capable model in allowedModelIds.`,
        hint: PLAN_BINDING_VISION_BLOCKER,
      });
    }
  }

  return issues;
}

/** 运行全部 entitlement 体检项，返回 issue 列表（只读）。 */
export async function runEntitlementDoctorChecks(
  cfg: OpenBotConfig | undefined,
  opts?: {
    entitlementStorePath?: string;
    subscriptionsStorePath?: string;
    plansStorePath?: string;
    planBindingStorePath?: string;
    modelCatalogStorePath?: string;
  },
): Promise<EntitlementDoctorIssue[]> {
  const [keyIssues, missingIssues, bindingIssues, catalogIssues] = await Promise.all([
    Promise.resolve(checkModelKeyConflicts(cfg)),
    checkEntitlementMissing(cfg, opts),
    checkPlanBindingIntegrity(cfg, opts),
    checkResourceCatalogIntegrity(cfg, {
      modelCatalogStorePath: opts?.modelCatalogStorePath,
      planBindingStorePath: opts?.planBindingStorePath,
    }),
  ]);
  return [
    ...keyIssues,
    ...missingIssues,
    ...bindingIssues,
    ...catalogIssues,
    ...checkCredentialConvergenceReadiness(cfg),
  ];
}

/**
 * P4（任务 15）凭证收敛就绪度观测（只读）。
 *
 * - `credentials.mode="legacy"`（默认）且存在 key 冲突：提示「收敛前需先消除冲突」
 *   （任务 15 的前置条件 —— doctor 冲突数据收敛后再 cutover）。
 * - `credentials.mode="catalog"`：提示已启用单源收敛；若仍有 env 遮蔽冲突，警告
 *   ambient env 可能与目录凭证不一致（catalog 模式下目录优先，但 env 仍残留宜清理）。
 */
export function checkCredentialConvergenceReadiness(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EntitlementDoctorIssue[] {
  const conflicts = checkModelKeyConflicts(cfg, env);
  const mode =
    cfg?.gateway?.platform?.models?.credentials?.mode === "catalog" ? "catalog" : "legacy";
  if (mode === "catalog") {
    if (conflicts.length === 0) {
      return [];
    }
    return [
      {
        code: "credential_convergence",
        severity: "warning",
        message: `credentials.mode=catalog is active but ${conflicts.length} provider(s) still have ambient env keys alongside the configured catalog credential. Catalog credential takes priority at runtime, but the residual env vars are stale and should be removed.`,
        hint: `Unset the shadow env variables so the single catalog credential is the only source. See design §6.4.`,
      },
    ];
  }
  // legacy 模式：仅当存在冲突时给出「收敛前提示」（info 级，不打扰无冲突环境）。
  if (conflicts.length === 0) {
    return [];
  }
  return [
    {
      code: "credential_convergence",
      severity: "info",
      message: `${conflicts.length} provider(s) have multiple key sources. Resolve these conflicts, then set gateway.platform.models.credentials.mode=catalog to converge to a single traceable credential per provider (model-entitlement-chain P4).`,
      hint: `Catalog mode makes the configured provider apiKey authoritative (no env shadowing). Converge conflicts first, then enable. See design §6.4.`,
    },
  ];
}
