/**
 * Employee Install Handlers — 员工端能力安装治理 RPC 网关方法。
 *
 * 模块定位：
 * 本文件承载 Phase 1 员工在「我的机器人」中发起能力安装、风险预览、配置应用等
 * 操作的 gateway RPC 方法。当前为 stub 实现，返回合理默认值以支撑 UI 闭环验证；
 * 后端持久化与运行时同步在后续阶段完善。
 *
 * 方法清单（按最小闭环优先级）：
 * 1. employee-install.list-sources      — 列出某机器人可安装的能力来源
 * 2. employee-install.scan-external     — 扫描外部/本地能力包
 * 3. employee-install.preview-risk      — 预览安装风险
 * 4. employee-install.create-request    — 创建安装请求
 * 5. employee-install.confirm           — 确认安装
 * 6. employee-install.check-configuration — 检查配置状态
 * 7. employee-install.apply-configuration — 应用配置
 * 8. employee-install.history           — 安装历史
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import {
  listBindings,
  updateBindingConfigurationState,
  updateBindingState,
  type RuntimeCapabilityBinding,
} from "../agent-runtime-store.js";
import {
  listRegistry,
  type GovernanceManifest,
  type GovernanceRegistryEntry,
} from "../capability-governance-store.js";
import { recordGovernanceEvent } from "../capability-install-governance-store.js";
import { resolveReviewRequiredPackSkill } from "../enterprise-data/pack-skill-review-gate.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { syncInstallToRuntime } from "../runtime-binding-sync.js";
import {
  describePackSkillReviewListFields,
  resolvePackSkillInstallBlock,
  respondIfPackSkillReviewBlocked,
  tryLoadPackSkillReviewSession,
} from "./pack-skill-review-install.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const STORE_DIR = path.join(os.homedir(), ".config", "openbot", "stores");
const INSTALL_STORE_FILE = path.join(STORE_DIR, "employee-install.json");

let loadAttempted = false;

interface SerializedInstallStore {
  installRequests: Array<[string, StubInstallRequest]>;
  scanResults: Array<[string, ScanResult]>;
}

function ensureLoaded(): void {
  if (loadAttempted) {
    return;
  }
  loadAttempted = true;
  try {
    if (!fs.existsSync(INSTALL_STORE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(INSTALL_STORE_FILE, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as SerializedInstallStore;
    if (parsed.installRequests) {
      for (const [key, value] of parsed.installRequests) {
        stubInstallRequests.set(key, value);
      }
    }
    if (parsed.scanResults) {
      for (const [key, value] of parsed.scanResults) {
        stubScanResults.set(key, value);
      }
    }
  } catch (err) {
    console.warn("[employee-install] load failed:", err);
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    const payload: SerializedInstallStore = {
      installRequests: Array.from(stubInstallRequests.entries()),
      scanResults: Array.from(stubScanResults.entries()),
    };
    fs.writeFileSync(INSTALL_STORE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    console.warn("[employee-install] persist failed:", err);
  }
}

// 导出测试辅助以便集成测试可以重置 store
export const __employeeInstallStoreInternals = {
  reset: () => {
    loadAttempted = false;
    stubInstallRequests.clear();
    stubScanResults.clear();
    try {
      if (fs.existsSync(INSTALL_STORE_FILE)) {
        fs.unlinkSync(INSTALL_STORE_FILE);
      }
    } catch {
      // ignore
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function requiredString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | undefined {
  const value = params[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `missing or empty param: ${key}`),
  );
  return undefined;
}

function requiredParam<T>(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
  guard: (v: unknown) => v is T,
  label: string,
): T | undefined {
  const value = params[key];
  if (guard(value)) {
    return value;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `missing or invalid param: ${key} (expected ${label})`),
  );
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Stub install request store (in-memory, per-process; will be replaced with persistent store)
// ─────────────────────────────────────────────────────────────────────────

type StubInstallRequest = {
  requestId: string;
  employeeId: string;
  targetRobotId: string;
  targetRobotName: string;
  capabilityId: string;
  capabilityName: string;
  source:
    | "platform-marketplace"
    | "enterprise-distributed"
    | "external-local"
    | "dabai-proxy"
    | "robot-self";
  status: string;
  riskLevel: string;
  riskItems: Array<{
    category: string;
    title: string;
    description: string;
    mitigation: string;
  }>;
  requiredPermissions: string[];
  requiredConfiguration: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    value?: string | number | boolean;
    options?: Array<{ label: string; value: string }>;
    helpText?: string;
  }>;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  bindingId?: string;
  contentHash?: string;
};

const stubInstallRequests = new Map<string, StubInstallRequest>();

// Scan result store for external/local validation (P1-4)
type ScanResult = {
  passed: boolean;
  overallRisk: string;
  recommendation: string;
  contentHash: string;
  targetRobotId: string;
  scannedAt: number;
};
const stubScanResults = new Map<string, ScanResult>();

function generateRequestId(): string {
  return `ei-${randomUUID()}`;
}

function sourceLabel(source: StubInstallRequest["source"]): string {
  switch (source) {
    case "enterprise-distributed":
      return "企业分发";
    case "external-local":
      return "外部/本地";
    case "dabai-proxy":
      return "大白代理";
    case "robot-self":
      return "机器人自装";
    case "platform-marketplace":
    default:
      return "平台市场";
  }
}

function sourceFromManifest(
  entry: GovernanceRegistryEntry,
): "platform-marketplace" | "enterprise-distributed" | "external-local" {
  if (entry.distribution.employeeVisibilityMode === "enterprise_only") {
    return "enterprise-distributed";
  }
  if (entry.manifest.source.trustTier === "third-party") {
    return "external-local";
  }
  return entry.distribution.defaultEnabled ? "enterprise-distributed" : "platform-marketplace";
}

function descriptionFromManifest(manifest: GovernanceManifest): string {
  return (
    manifest.descriptionZh?.trim() || manifest.description.trim() || `${manifest.name} 企业能力`
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function robotProfileTerms(targetRobotId: string): string[] {
  const cfg = loadConfig();
  const agent = cfg.agents?.list?.find((entry) => entry.id === targetRobotId);
  const text = [
    targetRobotId,
    agent?.name,
    agent?.identity?.name,
    agent?.identity?.theme,
    agent?.workspace,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text
    .split(/[\s,，。；;:/\\|()[\]{}"'`~!@#$%^&*_+=<>?-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function recommendationReasons(params: {
  entry: GovernanceRegistryEntry;
  targetRobotId: string;
  source: "platform-marketplace" | "enterprise-distributed" | "external-local";
  similarRobotCount: number;
  installed: boolean;
}): string[] {
  const reasons: string[] = [];
  const terms = robotProfileTerms(params.targetRobotId);
  const haystack = [
    params.entry.manifest.name,
    params.entry.manifest.description,
    params.entry.manifest.descriptionZh,
    params.entry.manifest.skillKey,
    ...stringList(params.entry.manifest.tags),
    typeof params.entry.manifest.category === "string" ? params.entry.manifest.category : "",
  ]
    .join(" ")
    .toLowerCase();
  const matched = terms.find((term) => haystack.includes(term));
  if (matched) {
    reasons.push(`匹配机器人画像关键词「${matched}」`);
  }
  if (params.entry.distribution.defaultEnabled || params.source === "enterprise-distributed") {
    reasons.push("来自企业已审核/分发能力池");
  }
  if (params.similarRobotCount > 0) {
    reasons.push(`已有 ${params.similarRobotCount} 个机器人绑定过该能力`);
  }
  if (params.installed) {
    reasons.push("当前机器人已安装，保留用于状态核对");
  }
  if (params.entry.manifest.source.trustTier === "first-party") {
    reasons.push("平台一方可信来源");
  }
  return reasons.length > 0 ? reasons : ["来自平台能力目录，作为补充候选展示"];
}

function bindingStatus(request?: StubInstallRequest, binding?: RuntimeCapabilityBinding) {
  const pendingConfiguration =
    request?.status === "pending-configuration" || binding?.configurationState === "pending";
  const restricted =
    request?.status === "restricted" ||
    binding?.governanceState === "restricted" ||
    binding?.bindingState === "disabled";
  // A request marked installed is a request record. It is executable only after a
  // runtime binding was actually synced. Status alone must not read as ready.
  const installed = Boolean(binding) || Boolean(request?.bindingId);
  return { installed, pendingConfiguration, restricted };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared install service helpers (extracted for reuse by agent-install-request)
// ─────────────────────────────────────────────────────────────────────────

export function createInstallRequest(input: {
  requestId: string;
  employeeId: string;
  targetRobotId: string;
  targetRobotName: string;
  capabilityId: string;
  capabilityName: string;
  source: StubInstallRequest["source"];
  riskLevel?: string;
  riskItems?: StubInstallRequest["riskItems"];
  requiredPermissions?: string[];
  requiredConfiguration?: StubInstallRequest["requiredConfiguration"];
  contentHash?: string;
}): StubInstallRequest {
  ensureLoaded();
  const now = Date.now();
  const request: StubInstallRequest = {
    requestId: input.requestId,
    employeeId: input.employeeId,
    targetRobotId: input.targetRobotId,
    targetRobotName: input.targetRobotName,
    capabilityId: input.capabilityId,
    capabilityName: input.capabilityName,
    source: input.source,
    status: "pending-confirmation",
    riskLevel: input.riskLevel ?? (input.source === "external-local" ? "medium" : "low"),
    riskItems: input.riskItems ?? [],
    requiredPermissions: input.requiredPermissions ?? ["read:messages"],
    requiredConfiguration: input.requiredConfiguration ?? [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    contentHash: input.contentHash,
  };
  stubInstallRequests.set(input.requestId, request);
  persist();
  return request;
}

type EmployeeInstallLayerReport = {
  status: string;
  completedAt: number | null;
  nextStep: string;
  bindingId?: string;
  executable: false;
  availability: "failed" | "degraded";
  relation: { state: "requested"; requestStatus: string };
  projection: { state: "not_materialized" };
  runtimeBinding: {
    role: "required";
    state: "synced" | "failed";
    synced: boolean;
    reason?: string;
    bindingId?: string;
  };
};

/**
 * D5 availability for this RPC only.
 * Unsynced binding is failed. A synced binding still has no materialized
 * projection and no next-loader evidence, so it is degraded. Never ready.
 */
export function resolveEmployeeInstallAvailability(synced: boolean): "failed" | "degraded" {
  return synced ? "degraded" : "failed";
}

function employeeInstallLayers(params: {
  request: StubInstallRequest;
  needsConfig: boolean;
  runtimeBinding: EmployeeInstallLayerReport["runtimeBinding"];
}): EmployeeInstallLayerReport {
  const nextStep = params.needsConfig
    ? "apply-configuration"
    : params.runtimeBinding.synced
      ? "done"
      : "runtime-binding-failed";
  return {
    status: params.request.status,
    completedAt: params.request.completedAt,
    nextStep,
    bindingId: params.request.bindingId,
    executable: false,
    availability: resolveEmployeeInstallAvailability(params.runtimeBinding.synced),
    relation: { state: "requested", requestStatus: params.request.status },
    projection: { state: "not_materialized" },
    runtimeBinding: params.runtimeBinding,
  };
}

export async function executeInstallConfirmation(
  request: StubInstallRequest,
  userEmail: string | null,
  options?: { client?: GatewayClient | null },
): Promise<EmployeeInstallLayerReport> {
  ensureLoaded();
  const now = Date.now();
  request.updatedAt = now;

  // P1-4: re-validate scan result for external-local source at confirm time
  if (request.source === "external-local" && request.contentHash) {
    const scanResult = stubScanResults.get(request.contentHash);
    if (!scanResult || !scanResult.passed || scanResult.recommendation === "block") {
      throw new Error("扫描结果无效或未通过，无法确认安装");
    }
  }

  // cn-office / enterprise_review_required: fulfilled pack_skill_review required.
  // Checked before status mutation and before syncInstallToRuntime.
  const reviewBlock = await resolvePackSkillInstallBlock({
    client: options?.client ?? null,
    capabilityId: request.capabilityId,
    targetRobotId: request.targetRobotId,
  });
  if (reviewBlock) {
    throw reviewBlock;
  }

  // Determine install outcome before runtime sync
  const needsConfig = request.requiredConfiguration.length > 0;
  if (needsConfig) {
    request.status = "pending-configuration";
    request.completedAt = null;
  } else {
    request.status = "installed";
    request.completedAt = now;
  }

  // Channel B is required for this entry. An empty email still calls the sync
  // function so the response can keep its structured reason (missing-user).
  let runtimeBinding: EmployeeInstallLayerReport["runtimeBinding"] = {
    role: "required",
    state: "failed",
    synced: false,
    reason: "missing-user",
  };
  try {
    const syncResult = await syncInstallToRuntime({
      cfg: loadConfig(),
      userEmail,
      capabilityId: request.capabilityId,
      targetRobotId: request.targetRobotId,
      installRequestId: request.requestId,
      tenantInstallSource: request.source,
      configurationState: needsConfig ? "pending" : "complete",
      governanceState: "approved",
    });
    if (!syncResult.synced) {
      runtimeBinding = {
        role: "required",
        state: "failed",
        synced: false,
        reason: syncResult.reason ?? "unknown",
      };
      console.warn(
        `[executeInstallConfirmation] runtime sync best-effort failed: ${runtimeBinding.reason ?? "unknown"}`,
      );
    } else if (syncResult.bindingId) {
      request.bindingId = syncResult.bindingId;
      runtimeBinding = {
        role: "required",
        state: "synced",
        synced: true,
        bindingId: syncResult.bindingId,
      };
      // P1-2: block invocation until configuration is applied
      if (needsConfig) {
        try {
          updateBindingState(syncResult.bindingId, "disabled");
        } catch (bindErr) {
          console.warn(
            "[executeInstallConfirmation] disable binding for pending-config failed:",
            bindErr,
          );
        }
      }
    } else {
      runtimeBinding = {
        role: "required",
        state: "failed",
        synced: false,
        reason: "binding-id-missing",
      };
    }
  } catch (syncErr) {
    runtimeBinding = {
      role: "required",
      state: "failed",
      synced: false,
      reason: "sync-exception",
    };
    console.warn("[executeInstallConfirmation] runtime sync exception:", syncErr);
  }

  // Record governance event (P1-3)
  recordGovernanceEvent({
    type: request.source === "external-local" ? "external-filing" : "install",
    capabilityId: request.capabilityId,
    capabilityName: request.capabilityName,
    actorId: request.employeeId,
    actorType:
      request.source === "dabai-proxy"
        ? "system"
        : request.source === "robot-self"
          ? "robot"
          : "employee",
    targetRobotId: request.targetRobotId,
    detail: `${sourceLabel(request.source)}安装能力到 ${request.targetRobotName}`,
    severity: request.source === "external-local" ? "medium" : "low",
    installRequestId: request.requestId,
  });

  persist();
  return employeeInstallLayers({ request, needsConfig, runtimeBinding });
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

export const employeeInstallHandlers: GatewayRequestHandlers = {
  "employee-install.list-sources": async ({ params, respond, client }) => {
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    if (!targetRobotId) {
      return;
    }

    const searchQuery = typeof params.searchQuery === "string" ? params.searchQuery : "";
    const sourceFilter = typeof params.sourceFilter === "string" ? params.sourceFilter : "all";

    ensureLoaded();
    const employeeId = client?.user ?? "anonymous";
    const targetRequests = Array.from(stubInstallRequests.values())
      .filter(
        (request) => request.employeeId === employeeId && request.targetRobotId === targetRobotId,
      )
      .toSorted((left, right) => right.createdAt - left.createdAt);
    const latestRequestByCapability = new Map<string, StubInstallRequest>();
    for (const request of targetRequests) {
      if (!latestRequestByCapability.has(request.capabilityId)) {
        latestRequestByCapability.set(request.capabilityId, request);
      }
    }
    const bindings = listBindings({
      runtimeAgentId: targetRobotId,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    const bindingByCapability = new Map(bindings.map((binding) => [binding.capabilityId, binding]));
    const installedCapabilityIds = new Set<string>([
      ...targetRequests
        .filter((request) => Boolean(request.bindingId))
        .map((request) => request.capabilityId),
      ...bindings.map((binding) => binding.capabilityId),
    ]);
    const registry = listRegistry().filter((entry) =>
      ["approved", "active"].includes(entry.lifecycleState),
    );
    const reviewSession = registry.some((entry) => resolveReviewRequiredPackSkill(entry))
      ? await tryLoadPackSkillReviewSession(client)
      : null;
    const registryCandidates = registry.map((entry) => {
      const source = sourceFromManifest(entry);
      const request = latestRequestByCapability.get(entry.manifest.id);
      const binding = bindingByCapability.get(entry.manifest.id);
      const status = bindingStatus(request, binding);
      const similarRobotCount = listBindings({
        runtimeAgentId: null,
        capabilityId: entry.manifest.id,
        bindingType: null,
        bindingState: null,
        health: null,
      }).filter((candidate) => candidate.runtimeAgentId !== targetRobotId).length;
      const reasons = recommendationReasons({
        entry,
        targetRobotId,
        source,
        similarRobotCount,
        installed: status.installed,
      });
      return {
        capabilityId: entry.manifest.id,
        capabilityName: entry.manifest.name,
        capabilitySummary: descriptionFromManifest(entry.manifest),
        source,
        sourceLabel: sourceLabel(source),
        version: entry.manifest.version,
        alreadyInstalled: status.installed,
        riskTags: [
          entry.manifest.risk.level === "low" ? "低风险" : `风险: ${entry.manifest.risk.level}`,
          entry.distribution.defaultEnabled ? "企业默认可用" : "需按企业策略确认",
        ],
        recommendationReasons: reasons,
        recommendationSource: entry.distribution.defaultEnabled
          ? ("enterprise-policy" as const)
          : reasons.some((reason) => reason.includes("机器人画像"))
            ? ("robot-profile" as const)
            : similarRobotCount > 0
              ? ("similar-robots" as const)
              : ("platform-fallback" as const),
        governanceLabel:
          entry.distribution.employeeVisibilityMode === "enterprise_review_required"
            ? "需要企业审核"
            : entry.distribution.employeeVisibilityMode === "enterprise_only"
              ? "仅企业分发"
              : "员工可见",
        requiresConfiguration: status.pendingConfiguration,
        requiresApproval:
          entry.distribution.employeeVisibilityMode === "enterprise_review_required",
        ...describePackSkillReviewListFields({
          capabilityId: entry.manifest.id,
          targetRobotId,
          session: reviewSession,
        }),
        matchScore: Math.min(1, 0.45 + reasons.length * 0.12 + (similarRobotCount > 0 ? 0.12 : 0)),
      };
    });
    const fallbackSources =
      registryCandidates.length > 0
        ? []
        : [
            {
              capabilityId: "cap-platform-001",
              capabilityName: "数据可视化",
              capabilitySummary: "自动生成图表与数据面板",
              source: "platform-marketplace" as const,
              sourceLabel: "平台市场",
              version: "2.1.0",
              alreadyInstalled: installedCapabilityIds.has("cap-platform-001"),
              riskTags: ["已通过平台安全审核"],
              recommendationReasons: ["示例候选：企业能力库暂无可见能力，展示平台补充来源"],
              recommendationSource: "platform-fallback" as const,
              governanceLabel: "示例来源",
              requiresConfiguration: false,
              requiresApproval: false,
              matchScore: 0.35,
            },
            {
              capabilityId: "cap-enterprise-001",
              capabilityName: "合同智能审查",
              capabilitySummary: "基于企业知识库的合同法务审查",
              source: "enterprise-distributed" as const,
              sourceLabel: "企业分发",
              version: "1.3.2",
              alreadyInstalled: installedCapabilityIds.has("cap-enterprise-001"),
              riskTags: ["企业认证"],
              recommendationReasons: ["示例候选：用于展示企业分发能力安装路径"],
              recommendationSource: "enterprise-policy" as const,
              governanceLabel: "示例来源",
              requiresConfiguration: false,
              requiresApproval: false,
              matchScore: 0.3,
            },
          ];

    let sources = [...registryCandidates, ...fallbackSources];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      sources = sources.filter(
        (s) =>
          s.capabilityName.toLowerCase().includes(q) ||
          s.capabilitySummary.toLowerCase().includes(q),
      );
    }
    if (sourceFilter !== "all") {
      sources = sources.filter((s) => s.source === sourceFilter);
    }
    sources = sources.toSorted((left, right) => {
      if (left.alreadyInstalled !== right.alreadyInstalled) {
        return left.alreadyInstalled ? 1 : -1;
      }
      return (right.matchScore ?? 0) - (left.matchScore ?? 0);
    });

    const history = targetRequests.map((request) => ({
      requestId: request.requestId,
      targetRobotId: request.targetRobotId,
      targetRobotName: request.targetRobotName,
      capabilityId: request.capabilityId,
      capabilityName: request.capabilityName,
      source: request.source,
      resultStatus:
        request.status === "installed"
          ? ("installed" as const)
          : request.status === "pending-configuration"
            ? ("pending-configuration" as const)
            : request.status === "restricted"
              ? ("restricted" as const)
              : ("failed" as const),
      riskLevel: request.riskLevel as "low" | "medium" | "high" | "critical",
      installedAt: request.createdAt,
    }));
    const summary = {
      installedCount: installedCapabilityIds.size,
      pendingConfigurationCount:
        [...latestRequestByCapability.values()].filter(
          (request) => request.status === "pending-configuration",
        ).length + bindings.filter((binding) => binding.configurationState === "pending").length,
      restrictedCount:
        [...latestRequestByCapability.values()].filter((request) => request.status === "restricted")
          .length + bindings.filter((binding) => binding.governanceState === "restricted").length,
      activeCount: bindings.filter((binding) => binding.bindingState === "active").length,
      lastInstalledAt: history[0]?.installedAt ?? null,
    };

    respond(true, { targetRobotId, sources, history, summary }, undefined);
  },

  "employee-install.scan-external": ({ params, respond }) => {
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    const contentHash = typeof params.contentHash === "string" ? params.contentHash : undefined;
    if (!targetRobotId) {
      return;
    }

    // Stub: simulate scan result based on content hash
    const isHighRisk = contentHash?.startsWith("bad");
    const result = {
      passed: !isHighRisk,
      findings: isHighRisk
        ? [
            {
              category: "unverified-source" as const,
              title: "未验证来源",
              description: "该能力包未通过平台安全审核",
              mitigation: "建议从平台市场或企业分发获取",
            },
            {
              category: "credential" as const,
              title: "凭证访问",
              description: "能力包请求访问机器人凭证存储",
              mitigation: "请确认是否允许访问",
            },
          ]
        : [
            {
              category: "policy" as const,
              title: "沙箱策略检查",
              description: "能力包将在受限沙箱中运行",
              mitigation: "无需额外操作，沙箱已自动启用",
            },
          ],
      overallRisk: isHighRisk ? ("high" as const) : ("low" as const),
      recommendation: isHighRisk ? ("block" as const) : ("proceed" as const),
      contentHash: contentHash ?? "unknown",
      scannedAt: Date.now(),
    };

    // P1-4: persist scan result for install validation
    ensureLoaded();
    stubScanResults.set(result.contentHash, {
      passed: result.passed,
      overallRisk: result.overallRisk,
      recommendation: result.recommendation,
      contentHash: result.contentHash,
      targetRobotId,
      scannedAt: result.scannedAt,
    });
    persist();

    respond(true, { targetRobotId, result }, undefined);
  },

  "employee-install.preview-risk": ({ params, respond }) => {
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    const source = requiredString(params, "source", respond);
    if (!targetRobotId || !capabilityId || !source) {
      return;
    }

    // Stub: return risk preview based on source type
    const isExternal = source === "external-local";
    const riskLevel = isExternal ? "medium" : "low";
    const riskItems = isExternal
      ? [
          {
            category: "unverified-source" as const,
            title: "未验证来源",
            description: "该能力来自外部/本地，未经过平台安全审核",
            mitigation: "建议在测试环境中先行验证",
          },
        ]
      : [
          {
            category: "policy" as const,
            title: "权限需求",
            description: "该能力需要访问机器人消息历史",
            mitigation: "安装后可随时在设置中撤销权限",
          },
        ];

    respond(
      true,
      {
        targetRobotId,
        capabilityId,
        source,
        riskLevel,
        riskItems,
        requiredPermissions: isExternal ? ["read:messages"] : ["read:messages", "write:messages"],
        requiredConfiguration: isExternal
          ? [
              {
                key: "sandbox_mode",
                label: "沙箱模式",
                type: "select" as const,
                required: true,
                options: [
                  { label: "严格（推荐）", value: "strict" },
                  { label: "标准", value: "standard" },
                ],
                helpText: "外部能力建议始终使用严格沙箱",
              },
            ]
          : [],
      },
      undefined,
    );
  },

  "employee-install.create-request": async ({ params, respond, client }) => {
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    const source = requiredString(params, "source", respond);
    if (!targetRobotId || !capabilityId || !source) {
      return;
    }
    const targetRobotName =
      typeof params.targetRobotName === "string" ? params.targetRobotName : targetRobotId;
    const capabilityName =
      typeof params.capabilityName === "string" ? params.capabilityName : capabilityId;

    // P1-4: external/local source must have a valid scan result
    // Must load from disk before checking (handles gateway restart case)
    ensureLoaded();
    if (source === "external-local") {
      const contentHash = typeof params.contentHash === "string" ? params.contentHash : "";
      if (!contentHash) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "外部/本地来源必须提供 contentHash 并通过扫描"),
        );
        return;
      }
      const scanResult = stubScanResults.get(contentHash);
      if (!scanResult) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "未找到扫描结果，请先执行 scan-external"),
        );
        return;
      }
      if (!scanResult.passed || scanResult.recommendation === "block") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "扫描未通过，禁止安装该外部能力包"),
        );
        return;
      }
    }

    const reviewBlock = await resolvePackSkillInstallBlock({
      client,
      capabilityId,
      targetRobotId,
    });
    if (reviewBlock) {
      respondIfPackSkillReviewBlocked(respond, reviewBlock);
      return;
    }

    const employeeId = client?.user ?? "anonymous";
    const requestId = generateRequestId();
    const now = Date.now();

    const request: StubInstallRequest = {
      requestId,
      employeeId,
      targetRobotId,
      targetRobotName,
      capabilityId,
      capabilityName,
      source: source as "platform-marketplace" | "enterprise-distributed" | "external-local",
      status: "pending-confirmation",
      riskLevel: source === "external-local" ? "medium" : "low",
      riskItems: [],
      requiredPermissions: ["read:messages"],
      requiredConfiguration:
        source === "external-local"
          ? [
              {
                key: "sandbox_mode",
                label: "沙箱模式",
                type: "select",
                required: true,
                options: [
                  { label: "严格（推荐）", value: "strict" },
                  { label: "标准", value: "standard" },
                ],
                helpText: "外部能力建议始终使用严格沙箱",
              },
            ]
          : [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      contentHash:
        source === "external-local"
          ? typeof params.contentHash === "string"
            ? params.contentHash
            : undefined
          : undefined,
    };

    ensureLoaded();
    stubInstallRequests.set(requestId, request);
    persist();

    respond(
      true,
      {
        requestId,
        status: request.status,
        riskLevel: request.riskLevel,
        requiredPermissions: request.requiredPermissions,
        requiredConfiguration: request.requiredConfiguration,
      },
      undefined,
    );
  },

  "employee-install.confirm": async ({ params, respond, client }) => {
    const requestId = requiredString(params, "requestId", respond);
    if (!requestId) {
      return;
    }

    ensureLoaded();
    const request = stubInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const userEmail = typeof client?.user === "string" ? client.user : null;
    try {
      const result = await executeInstallConfirmation(request, userEmail, { client });
      respond(
        true,
        {
          requestId,
          status: result.status,
          completedAt: result.completedAt,
          nextStep: result.nextStep,
          executable: result.executable,
          availability: result.availability,
          relation: result.relation,
          projection: result.projection,
          runtimeBinding: result.runtimeBinding,
        },
        undefined,
      );
    } catch (err) {
      if (respondIfPackSkillReviewBlocked(respond, err)) {
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "confirm failed",
        ),
      );
    }
  },

  "employee-install.check-configuration": ({ params, respond }) => {
    const requestId = requiredString(params, "requestId", respond);
    if (!requestId) {
      return;
    }

    ensureLoaded();
    const request = stubInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const isPendingConfig = request.status === "pending-configuration";
    respond(
      true,
      {
        requestId,
        status: request.status,
        configurationState: isPendingConfig ? "pending" : "complete",
        requiredConfiguration: request.requiredConfiguration,
      },
      undefined,
    );
  },

  "employee-install.apply-configuration": async ({ params, respond, client }) => {
    const requestId = requiredString(params, "requestId", respond);
    if (!requestId) {
      return;
    }

    ensureLoaded();
    const request = stubInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const configuration = requiredParam<Record<string, string | number | boolean>>(
      params,
      "configuration",
      respond,
      (v): v is Record<string, string | number | boolean> =>
        typeof v === "object" && v !== null && !Array.isArray(v),
      "record of string/number/boolean",
    );
    if (!configuration) {
      return;
    }

    const reviewBlock = await resolvePackSkillInstallBlock({
      client,
      capabilityId: request.capabilityId,
      targetRobotId: request.targetRobotId,
    });
    if (reviewBlock) {
      respondIfPackSkillReviewBlocked(respond, reviewBlock);
      return;
    }

    // Apply configuration values
    for (const field of request.requiredConfiguration) {
      if (field.key in configuration) {
        field.value = configuration[field.key];
      }
    }

    const now = Date.now();
    request.status = "installed";
    request.updatedAt = now;
    request.completedAt = now;

    // P1-2: re-enable binding now that configuration is complete
    let bindingSynced = false;
    let bindingReason: string | undefined = "binding-not-synced";
    if (request.bindingId) {
      try {
        updateBindingState(request.bindingId, "active");
        updateBindingConfigurationState(request.bindingId, "complete");
        bindingSynced = true;
        bindingReason = undefined;
      } catch (bindErr) {
        bindingReason = "binding-reactivate-failed";
        console.warn("[employee-install.apply-configuration] re-enable binding failed:", bindErr);
      }
    }

    persist();
    const runtimeBinding = {
      role: "required" as const,
      state: bindingSynced ? ("synced" as const) : ("failed" as const),
      synced: bindingSynced,
      reason: bindingReason,
      bindingId: request.bindingId,
    };
    const layers = employeeInstallLayers({
      request,
      needsConfig: false,
      runtimeBinding,
    });
    respond(
      true,
      {
        requestId,
        status: request.status,
        configurationState: "complete",
        appliedValues: configuration,
        completedAt: now,
        executable: layers.executable,
        availability: layers.availability,
        relation: layers.relation,
        projection: layers.projection,
        runtimeBinding: layers.runtimeBinding,
        nextStep: layers.nextStep,
      },
      undefined,
    );
  },

  "employee-install.history": ({ params, respond, client }) => {
    ensureLoaded();
    const targetRobotId =
      typeof params.targetRobotId === "string" ? params.targetRobotId : undefined;
    const employeeId = client?.user ?? "anonymous";

    let items = Array.from(stubInstallRequests.values()).filter((r) => r.employeeId === employeeId);
    if (targetRobotId) {
      items = items.filter((r) => r.targetRobotId === targetRobotId);
    }

    // Sort by createdAt desc
    items.sort((a, b) => b.createdAt - a.createdAt);

    respond(
      true,
      {
        items: items.map((r) => ({
          requestId: r.requestId,
          targetRobotId: r.targetRobotId,
          targetRobotName: r.targetRobotName,
          capabilityId: r.capabilityId,
          capabilityName: r.capabilityName,
          source: r.source,
          resultStatus:
            r.status === "installed"
              ? ("installed" as const)
              : r.status === "pending-configuration"
                ? ("pending-configuration" as const)
                : r.status === "restricted"
                  ? ("restricted" as const)
                  : ("failed" as const),
          riskLevel: r.riskLevel as "low" | "medium" | "high" | "critical",
          installedAt: r.createdAt,
        })),
      },
      undefined,
    );
  },
};
