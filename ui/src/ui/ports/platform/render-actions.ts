import {
  DiscoveryDispatcher,
  githubTopicAdapter,
  npmAdapter,
} from "../../capability/capability-governance/discovery/index.ts";
import type { DiscoveredCapability } from "../../capability/capability-governance/discovery/types.ts";
import {
  approveProposal,
  deprecate,
  promoteDistribution,
  rejectProposal,
  retire,
  revokeDistribution,
} from "../../capability/capability-governance/facade.ts";
import { manifestFromSkillEntry } from "../../capability/capability-governance/normalizer.ts";
import type {
  CapabilityDistributionScope,
  CapabilityEmployeeVisibilityMode,
} from "../../capability/capability-governance/types.ts";
import { channelsCapability } from "../../capability/channels/index.ts";
import { configCapability } from "../../capability/config/index.ts";
import { debugCapability } from "../../capability/debug/index.ts";
import { execApprovalsCapability } from "../../capability/exec-approvals/facade.ts";
import { logsCapability } from "../../capability/logs/index.ts";
import { presenceCapability } from "../../capability/presence/index.ts";
import { sessionsCapability } from "../../capability/sessions/facade.ts";
import { skillsCapability } from "../../capability/skills/facade.ts";
import type { AppCapabilitySlices } from "../../capability/view-state.ts";
import {
  adaptChannelsLoadCapabilityState,
  adaptConfigFormCapabilityState,
  adaptConfigSaveCapabilityState,
  adaptConfigUpdateCapabilityState,
  adaptDebugLoadCapabilityState,
  adaptLogsLoadCapabilityState,
  adaptPresenceLoadCapabilityState,
} from "../../capability/view-state.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "../../controllers/devices.ts";
import { loadNodes } from "../../controllers/nodes.ts";
import { loadPlatformModelsManagementSnapshot } from "../../controllers/platform-models-management.ts";
import type { ChannelsProps } from "../../views/channels.types.ts";
import type { PlatformPortActionState } from "./action-state.ts";
import type {
  EnterpriseSubmissionDetail,
  EnterpriseSubmissionsListResponse,
} from "./capabilities/enterprise-submissions-types.ts";
import { refreshCapabilityGovernanceSnapshot } from "./capability-governance-gateway.ts";
import { getOrCreateCapabilityGovernanceViewState } from "./capability-governance-state.ts";
import { buildPlatformModelDefinitionEntry } from "./models/platform-model-definition.ts";

// Module-level discovery dispatcher with npm + GitHub adapters pre-registered.
const discoveryDispatcher = new DiscoveryDispatcher([npmAdapter, githubTopicAdapter]);

export type CreatePlatformPortActionsArgs = {
  actionState: PlatformPortActionState;
  capabilityState: AppCapabilitySlices;
};

type ChannelConfigPath = Parameters<ChannelsProps["onConfigPatch"]>[0];
type ChannelProfile = Parameters<ChannelsProps["onNostrProfileEdit"]>[1];
type ChannelProfileField = Parameters<ChannelsProps["onNostrProfileFieldChange"]>[0];
type ExecApprovalsPath = Array<string | number>;
type SessionPatch = {
  label?: string | null;
  thinkingLevel?: string | null;
  verboseLevel?: string | null;
  reasoningLevel?: string | null;
};
type CapabilityGovernanceMethod =
  | "capabilities.governance.listProposals"
  | "capabilities.governance.listRegistry"
  | "capabilities.governance.submitProposal"
  | "capabilities.governance.resolveRemoteImport"
  | "capabilities.governance.approveProposal"
  | "capabilities.governance.rejectProposal"
  | "capabilities.governance.updateDistribution"
  | "capabilities.governance.updateLifecycle"
  | "capabilities.governance.updateManifest";

type PlatformCapabilityMethod =
  | "platform-capability.enterprise-submissions"
  | "platform-capability.review-enterprise-submission"
  | "platform-capability.publish-enterprise-capability"
  | "platform-capability.reject-enterprise-capability"
  | "platform-capability.return-for-modification"
  | "platform-capability.approve-enterprise-only";

export type PlatformModelAddInput = {
  providerId: string;
  baseUrl: string;
  modelId: string;
  name: string;
  api: string;
  /** Omit or null when unknown — do not invent 128k/8k defaults. */
  contextWindow?: number | null;
  maxTokens?: number | null;
  inputModes: Array<"text" | "image">;
  reasoning: boolean;
  apiKey: string;
  /**
   * Executor call type for the platform capability archive / UI labels only.
   * Must NOT be written into models.providers.*.models[] (ModelDefinitionSchema.strict()).
   */
  callType?: "text_chat" | "image_generation" | "music_generation";
};

export type PlatformModelProviderUpdateInput = {
  providerId: string;
  baseUrl: string;
  api: string;
  auth: string;
  apiKey: string;
};

export type PlatformModelUpdateInput = PlatformModelAddInput;

export type PlatformCatalogImportInput = {
  providerId: string;
  modelId: string;
  name: string;
  contextWindow?: number | null;
};

export type PlatformTaskPlanConfigInput = {
  planId: string;
  taskProfileId?: string | null;
  primaryModelIds: string[];
  fallbackModelIds: string[];
};

export type PlatformRoutingPolicyConfigInput = {
  policyId: string;
  name?: string | null;
  taskProfileId?: string | null;
  planId?: string | null;
  primaryModelIds: string[];
  fallbackModelIds: string[];
  status?: "active" | "draft" | "disabled" | null;
  rankingMode?: "quality" | "cost" | "speed" | "balanced" | null;
  maxCostPerRequest?: number | null;
  maxLatencyMs?: number | null;
  requiredCapabilities?: string[] | null;
  requiredHealth?: "healthy" | "not_unavailable" | null;
};

type ConfigRuntimeView = {
  configForm?: Record<string, unknown> | null;
  configSnapshot?: { config?: Record<string, unknown> | null } | null;
  configFormDirty?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function currentConfigValue(config: ConfigRuntimeView): Record<string, unknown> {
  if (config.configFormDirty) {
    return config.configForm ?? config.configSnapshot?.config ?? {};
  }
  return config.configSnapshot?.config ?? config.configForm ?? {};
}

function currentProviderConfig(config: ConfigRuntimeView, providerId: string) {
  const modelsConfig = asRecord(currentConfigValue(config).models);
  const providers = asRecord(modelsConfig?.providers);
  return asRecord(providers?.[providerId]);
}

function currentProviderModels(config: ConfigRuntimeView, providerId: string): unknown[] {
  const provider = currentProviderConfig(config, providerId);
  return Array.isArray(provider?.models) ? provider.models : [];
}

function modelEntryId(entry: unknown): string | null {
  if (typeof entry === "string" && entry.trim()) {
    return entry.trim();
  }
  const record = asRecord(entry);
  return typeof record?.id === "string" && record.id.trim() ? record.id.trim() : null;
}

function normalizeModelApi(value: string) {
  const trimmed = value.trim();
  return trimmed || "openai-responses";
}

function defaultsModelValue(config: ConfigRuntimeView, key: "model" | "imageModel") {
  const agents = asRecord(currentConfigValue(config).agents);
  const defaults = asRecord(agents?.defaults);
  return defaults?.[key];
}

function defaultsModelsCatalog(config: ConfigRuntimeView) {
  const agents = asRecord(currentConfigValue(config).agents);
  const defaults = asRecord(agents?.defaults);
  return asRecord(defaults?.models);
}

function currentTaskPlanConfig(config: ConfigRuntimeView, planId: string) {
  const modelsConfig = asRecord(currentConfigValue(config).models);
  const taskPlans = asRecord(modelsConfig?.taskPlans);
  return asRecord(taskPlans?.[planId]);
}

function currentRoutingPolicyConfig(config: ConfigRuntimeView, policyId: string) {
  const modelsConfig = asRecord(currentConfigValue(config).models);
  const routingPolicies = asRecord(modelsConfig?.routingPolicies);
  return asRecord(routingPolicies?.[policyId]);
}

function currentRoutingPolicyDirectory(config: ConfigRuntimeView) {
  const modelsConfig = asRecord(currentConfigValue(config).models);
  return asRecord(modelsConfig?.routingPolicies) ?? {};
}

function uniqueRoutingPolicyId(config: ConfigRuntimeView, basePolicyId: string) {
  const existing = currentRoutingPolicyDirectory(config);
  const base = `${basePolicyId.trim() || "routing-policy"}-copy`;
  if (!(base in existing)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!(candidate in existing)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function resolveDefaultPrimaryValue(
  config: ConfigRuntimeView,
  key: "model" | "imageModel",
): string | null {
  const value = defaultsModelValue(config, key);
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const record = asRecord(value);
  return typeof record?.primary === "string" && record.primary.trim()
    ? record.primary.trim()
    : null;
}

function resolveDefaultFallbackValues(config: ConfigRuntimeView): string[] {
  const record = asRecord(defaultsModelValue(config, "model"));
  const fallbacks = Array.isArray(record?.fallbacks)
    ? record.fallbacks
    : Array.isArray(record?.fallback)
      ? record.fallback
      : [];
  return fallbacks.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

export function createPlatformPortActions({
  actionState,
  capabilityState,
}: CreatePlatformPortActionsArgs) {
  const channelsLoadState = adaptChannelsLoadCapabilityState(capabilityState.channels);
  const configFormState = adaptConfigFormCapabilityState(capabilityState.config);
  const configSaveState = adaptConfigSaveCapabilityState(capabilityState.config);
  const configUpdateState = adaptConfigUpdateCapabilityState(capabilityState.config);
  const configRuntime: ConfigRuntimeView = {
    ...(capabilityState.config as ConfigRuntimeView),
    configFormDirty: configFormState.configFormDirty,
  };
  const debugLoadState = adaptDebugLoadCapabilityState(actionState);
  const logsLoadState = adaptLogsLoadCapabilityState(actionState);
  const presenceLoadState = adaptPresenceLoadCapabilityState(actionState);
  const sessionsLoadState = actionState;
  const sessionsManageState = actionState;
  const skillsLoadState = actionState;
  const skillsManageState = actionState;
  const governanceReviewerId =
    actionState.platformAuthState?.session?.user?.trim() ||
    actionState.platformAuthState?.session?.displayName?.trim() ||
    "platform-ui";

  const requestCapabilityGovernance = async <T>(
    method: CapabilityGovernanceMethod,
    params: Record<string, unknown>,
  ): Promise<T | null> => {
    if (!actionState.client || !actionState.connected) {
      actionState.lastError = "尚未连接到 Gateway。";
      return null;
    }
    actionState.lastError = null;
    try {
      return await actionState.client.request<T>(method, params);
    } catch (error) {
      actionState.lastError = error instanceof Error ? error.message : "能力治理操作失败。";
      return null;
    }
  };

  const refreshCapabilityReviewState = async () => {
    try {
      await actionState.loadOverview();
      await refreshCapabilityGovernanceSnapshot(actionState);
      await skillsCapability.load(skillsLoadState, { clearMessages: false });
    } catch (error) {
      // The review RPC already landed. A follow-up refresh failure must not
      // hide that outcome; the optimistic override still updates the list.
      actionState.lastError = error instanceof Error ? error.message : "能力治理状态刷新失败。";
    }
  };

  const requestPlatformCapability = async <T>(
    method: PlatformCapabilityMethod,
    params: Record<string, unknown>,
  ): Promise<T> => {
    if (!actionState.client || !actionState.connected) {
      throw new Error("尚未连接到 Gateway。");
    }
    actionState.lastError = null;
    return await actionState.client.request<T>(method, params);
  };

  const saveConfigAndRefreshModelsManagement = async () => {
    await configCapability.save(configSaveState);
    // Only reload the canonical snapshot after a successful save. When the
    // form is still dirty, the save was skipped or failed and the prior
    // snapshot remains the best known runtime state.
    if (configSaveState.configFormDirty) {
      return;
    }
    await actionState.loadOverview();
    await loadPlatformModelsManagementSnapshot(actionState);
  };

  return {
    dashboard: {
      onRefresh: () => actionState.loadOverview(),
    },
    tenants: {
      onRefresh: () => actionState.loadOverview(),
      onRefreshDirectory: () => actionState.loadOverview(),
      onRefreshCoverage: () => actionState.loadOverview(),
    },
    capabilities: {
      onRefresh: async () => {
        await actionState.loadOverview();
        await refreshCapabilityGovernanceSnapshot(actionState);
        await skillsCapability.load(skillsLoadState, { clearMessages: false });
      },
      onRefreshCatalog: () => skillsCapability.load(skillsLoadState, { clearMessages: false }),
      onRefreshInstalled: async () => {
        await actionState.loadOverview();
        await skillsCapability.load(skillsLoadState, { clearMessages: false });
      },
      onRefreshSetupHealth: () => actionState.loadOverview(),
      onResolveRemoteImport: async (input: string) => {
        const result = await requestCapabilityGovernance<{ items?: DiscoveredCapability[] }>(
          "capabilities.governance.resolveRemoteImport",
          { input },
        );
        return result?.items ?? [];
      },
      // --- Governance actions (B-plan). These are optimistic-update stubs
      // today; each will be backed by a gateway method once persistence
      // lands on the platform DB. See capability-governance/facade.ts.
      onDiscover: async (_sourceIds?: readonly string[]) => {
        // First, persist currently visible workspace / managed skills as proposals
        // when they are not yet represented in the governance registry.
        const registryRes = await requestCapabilityGovernance<{
          entries?: Array<{ manifest?: { skillKey?: string | null } | null }>;
        }>("capabilities.governance.listRegistry", {});
        const registrySkillKeys = new Set(
          (registryRes?.entries ?? [])
            .map((entry) => entry.manifest?.skillKey?.trim())
            .filter((value): value is string => Boolean(value)),
        );
        const localSkills = actionState.skillsReport?.skills ?? [];
        for (const skill of localSkills) {
          if (registrySkillKeys.has(skill.skillKey)) {
            continue;
          }
          const manifest = manifestFromSkillEntry(skill);
          await requestCapabilityGovernance<unknown>("capabilities.governance.submitProposal", {
            proposalId: `proposal:${manifest.id}`,
            manifest,
            findings: [],
            submittedBy: skill.source,
          });
        }
        // Then run external discovery adapters (npm, etc.) for future expansion.
        await discoveryDispatcher.run();
        await actionState.loadOverview();
        await refreshCapabilityGovernanceSnapshot(actionState);
        await skillsCapability.load(skillsLoadState, { clearMessages: false });
      },
      onSubmitExternalProposal: async (item: DiscoveredCapability) => {
        const proposalId = `proposal:${item.sourceId}:${item.externalId}@${item.version}`;
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.submitProposal",
          {
            proposalId,
            manifest: item.manifest,
            findings: item.findings,
            submittedBy: item.sourceId,
          },
        );
        if (!result) {
          return;
        }
        await actionState.loadOverview();
        await refreshCapabilityGovernanceSnapshot(actionState);
        await skillsCapability.load(skillsLoadState, { clearMessages: false });
      },
      onApproveProposal: async (proposalId: string, reviewerId?: string) => {
        const actor = reviewerId?.trim() || governanceReviewerId;
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.approveProposal",
          {
            proposalId,
            reviewerId: actor,
          },
        );
        if (!result) {
          return {
            ok: false as const,
            message: actionState.lastError?.trim() || "批准失败，提案状态未改变。",
          };
        }
        approveProposal(getOrCreateCapabilityGovernanceViewState(), proposalId, actor);
        await refreshCapabilityReviewState();
        return { ok: true as const };
      },
      onRejectProposal: async (proposalId: string, reviewerId: string, note: string) => {
        const actor = reviewerId?.trim() || governanceReviewerId;
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.rejectProposal",
          {
            proposalId,
            reviewerId: actor,
            note,
          },
        );
        if (!result) {
          return {
            ok: false as const,
            message: actionState.lastError?.trim() || "拒绝失败，提案状态未改变。",
          };
        }
        rejectProposal(getOrCreateCapabilityGovernanceViewState(), proposalId, actor, note);
        await refreshCapabilityReviewState();
        return { ok: true as const };
      },
      onPromoteDistribution: async (
        manifestId: string,
        scope: CapabilityDistributionScope,
        employeeVisibilityMode: CapabilityEmployeeVisibilityMode,
        updatedBy: string,
      ) => {
        const actor = updatedBy?.trim() || governanceReviewerId;
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.updateDistribution",
          {
            manifestId,
            scope,
            defaultEnabled: true,
            employeeVisibilityMode,
            updatedBy: actor,
          },
        );
        if (!result) {
          return;
        }
        promoteDistribution(
          getOrCreateCapabilityGovernanceViewState(),
          manifestId,
          scope,
          employeeVisibilityMode,
          actor,
        );
        await actionState.loadOverview();
      },
      onRevokeDistribution: async (manifestId: string, updatedBy: string) => {
        const actor = updatedBy?.trim() || governanceReviewerId;
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.updateDistribution",
          {
            manifestId,
            scope: {},
            defaultEnabled: false,
            updatedBy: actor,
          },
        );
        if (!result) {
          return;
        }
        revokeDistribution(getOrCreateCapabilityGovernanceViewState(), manifestId, actor);
        await actionState.loadOverview();
      },
      onDeprecate: async (manifestId: string) => {
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.updateLifecycle",
          {
            manifestId,
            state: "deprecated",
          },
        );
        if (!result) {
          return;
        }
        deprecate(getOrCreateCapabilityGovernanceViewState(), manifestId);
        await actionState.loadOverview();
      },
      onRetire: async (manifestId: string) => {
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.updateLifecycle",
          {
            manifestId,
            state: "retired",
          },
        );
        if (!result) {
          return;
        }
        retire(getOrCreateCapabilityGovernanceViewState(), manifestId);
        await actionState.loadOverview();
      },
      onUpdateManifest: async (
        manifestId: string,
        patch: {
          name?: string;
          description?: string;
          descriptionZh?: string;
          categoryId?: string;
        },
      ) => {
        const result = await requestCapabilityGovernance<unknown>(
          "capabilities.governance.updateManifest",
          {
            manifestId,
            patch,
          },
        );
        if (!result) {
          return;
        }
        await actionState.loadOverview();
      },
      onRefreshEnterpriseSubmissions: async () => {
        return await requestPlatformCapability<EnterpriseSubmissionsListResponse>(
          "platform-capability.enterprise-submissions",
          {},
        );
      },
      onReviewEnterpriseSubmission: async (submissionId: string) => {
        return await requestPlatformCapability<EnterpriseSubmissionDetail>(
          "platform-capability.review-enterprise-submission",
          { submissionId },
        );
      },
      onPublishEnterpriseSubmission: async (submissionId: string, reviewerId?: string) => {
        const actor = reviewerId?.trim() || governanceReviewerId;
        await requestPlatformCapability("platform-capability.publish-enterprise-capability", {
          submissionId,
          reviewerId: actor,
        });
        await refreshCapabilityGovernanceSnapshot(actionState);
        await actionState.loadOverview();
      },
      onRejectEnterpriseSubmission: async (submissionId: string, rejectionReason: string) => {
        const actor = governanceReviewerId;
        await requestPlatformCapability("platform-capability.reject-enterprise-capability", {
          submissionId,
          reviewerId: actor,
          rejectionReason,
        });
      },
      onReturnEnterpriseSubmission: async (submissionId: string, returnNotes: string) => {
        const actor = governanceReviewerId;
        await requestPlatformCapability("platform-capability.return-for-modification", {
          submissionId,
          reviewerId: actor,
          returnNotes,
        });
      },
      onApproveEnterpriseOnlySubmission: async (submissionId: string, reviewerId?: string) => {
        const actor = reviewerId?.trim() || governanceReviewerId;
        await requestPlatformCapability("platform-capability.approve-enterprise-only", {
          submissionId,
          reviewerId: actor,
        });
        await refreshCapabilityGovernanceSnapshot(actionState);
        await actionState.loadOverview();
      },
    },
    models: {
      onRefresh: async () => {
        await actionState.loadOverview();
        await loadPlatformModelsManagementSnapshot(actionState);
        await debugCapability.load(debugLoadState);
      },
      onRefreshPool: async () => {
        await actionState.loadOverview();
        await loadPlatformModelsManagementSnapshot(actionState);
        await debugCapability.load(debugLoadState);
      },
      onRefreshCatalog: () => debugCapability.load(debugLoadState),
      onProbeHealth: async (params?: {
        provider?: string;
        modelRef?: string;
        timeoutMs?: number;
      }) => {
        const summary = await debugCapability.probeModels(debugLoadState, params);
        if (summary && !configSaveState.configFormDirty) {
          await loadPlatformModelsManagementSnapshot(actionState);
        }
        return summary;
      },
      onRefreshPolicies: () => actionState.loadOverview(),
      onRefreshOverrides: () => actionState.loadOverview(),
      onSetMode: (mode: "merge" | "replace") =>
        configCapability.updateFormValue(configFormState, ["models", "mode"], mode),
      onAddModel: (input: PlatformModelAddInput) => {
        const providerId = input.providerId.trim();
        const modelId = input.modelId.trim();
        if (!providerId || !modelId) {
          actionState.lastError = "Provider ID and model ID are required.";
          return;
        }
        const existingProvider = currentProviderConfig(configRuntime, providerId) ?? {};
        const existingModels = currentProviderModels(configRuntime, providerId);
        // callType stays out of the model entry — platform capability archive only.
        const nextModel = buildPlatformModelDefinitionEntry({
          modelId,
          name: input.name,
          api: normalizeModelApi(input.api),
          reasoning: input.reasoning,
          inputModes: input.inputModes,
          contextWindow: input.contextWindow,
          maxTokens: input.maxTokens,
        });
        const nextProvider = {
          ...existingProvider,
          baseUrl:
            input.baseUrl.trim() ||
            (typeof existingProvider.baseUrl === "string" ? existingProvider.baseUrl : ""),
          api: normalizeModelApi(
            input.api || (typeof existingProvider.api === "string" ? existingProvider.api : ""),
          ),
          ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}),
          models: [...existingModels.filter((entry) => modelEntryId(entry) !== modelId), nextModel],
        };
        configCapability.updateFormValue(
          configFormState,
          ["models", "providers", providerId],
          nextProvider,
        );
        // 平台端配 key 即自动启用 catalog 凭证模式（同 onUpdateProvider）：
        // 让刚配置的内联 key 成为运行时权威来源，无需手动开开关。
        if (input.apiKey.trim()) {
          configCapability.updateFormValue(
            configFormState,
            ["gateway", "platform", "models", "credentials", "mode"],
            "catalog",
          );
        }
      },
      onImportCatalogModel: (input: PlatformCatalogImportInput) => {
        const providerId = input.providerId.trim();
        const modelId = input.modelId.trim();
        if (!providerId || !modelId) {
          actionState.lastError = "Catalog provider/model is required.";
          return;
        }
        const existingProvider = currentProviderConfig(configRuntime, providerId) ?? {};
        const existingModels = currentProviderModels(configRuntime, providerId);
        const nextModel = {
          id: modelId,
          name: input.name.trim() || modelId,
          api: normalizeModelApi(
            typeof existingProvider.api === "string" ? existingProvider.api : "openai-responses",
          ),
          reasoning: false,
          input: ["text"],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          ...(input.contextWindow != null && Number(input.contextWindow) > 0
            ? { contextWindow: Math.floor(Number(input.contextWindow)) }
            : {}),
        };
        const nextProvider = {
          ...existingProvider,
          baseUrl: typeof existingProvider.baseUrl === "string" ? existingProvider.baseUrl : "",
          api: normalizeModelApi(
            typeof existingProvider.api === "string" ? existingProvider.api : "openai-responses",
          ),
          models: [...existingModels.filter((entry) => modelEntryId(entry) !== modelId), nextModel],
        };
        configCapability.updateFormValue(
          configFormState,
          ["models", "providers", providerId],
          nextProvider,
        );
        // 「入池」= 显式配置 + 进入 agents.defaults.models 路由池。
        // 只写 providers 时，management snapshot 仍会标 allowlisted=false，列表继续显示「待入池」。
        const modelRef = `${providerId}/${modelId}`;
        const existingCatalog = defaultsModelsCatalog(configRuntime) ?? {};
        const existingEntry = asRecord(existingCatalog[modelRef]) ?? {};
        const alias = input.name.trim();
        configCapability.updateFormValue(
          configFormState,
          ["agents", "defaults", "models", modelRef],
          {
            ...existingEntry,
            ...(alias ? { alias } : {}),
          },
        );
      },
      onUpdateProvider: (input: PlatformModelProviderUpdateInput) => {
        const providerId = input.providerId.trim();
        if (!providerId) {
          return;
        }
        const existingProvider = currentProviderConfig(configRuntime, providerId) ?? {};
        const nextProvider = {
          ...existingProvider,
          baseUrl: input.baseUrl.trim(),
          api: normalizeModelApi(input.api),
          auth: input.auth.trim() || "api-key",
          ...(input.apiKey.trim() ? { apiKey: input.apiKey.trim() } : {}),
        };
        configCapability.updateFormValue(
          configFormState,
          ["models", "providers", providerId],
          nextProvider,
        );
        // 平台端配 key 即自动启用 catalog 凭证模式：让刚配置的内联 key 成为运行时权威来源
        //（优先于残留 auth-profile / 失效 env），管理员无需手动开开关，配完热生效。
        if (input.apiKey.trim()) {
          configCapability.updateFormValue(
            configFormState,
            ["gateway", "platform", "models", "credentials", "mode"],
            "catalog",
          );
        }
      },
      onRemoveProvider: (providerId: string) => {
        const normalizedProviderId = providerId.trim();
        if (!normalizedProviderId) {
          return;
        }
        configCapability.removeFormValue(configFormState, [
          "models",
          "providers",
          normalizedProviderId,
        ]);
      },
      onUpdateModel: (input: PlatformModelUpdateInput) => {
        const providerId = input.providerId.trim();
        const modelId = input.modelId.trim();
        if (!providerId || !modelId) {
          actionState.lastError = "Provider ID and model ID are required.";
          return;
        }
        const existingProvider = currentProviderConfig(configRuntime, providerId) ?? {};
        const existingModels = currentProviderModels(configRuntime, providerId);
        const nextModel = buildPlatformModelDefinitionEntry({
          modelId,
          name: input.name,
          api: normalizeModelApi(input.api),
          reasoning: input.reasoning,
          inputModes: input.inputModes,
          contextWindow: input.contextWindow,
          maxTokens: input.maxTokens,
        });
        const nextProvider = {
          ...existingProvider,
          baseUrl:
            input.baseUrl.trim() ||
            (typeof existingProvider.baseUrl === "string" ? existingProvider.baseUrl : ""),
          api: normalizeModelApi(
            input.api || (typeof existingProvider.api === "string" ? existingProvider.api : ""),
          ),
          models: existingModels.map((entry) =>
            modelEntryId(entry) === modelId ? nextModel : entry,
          ),
        };
        configCapability.updateFormValue(
          configFormState,
          ["models", "providers", providerId],
          nextProvider,
        );
      },
      onRemoveModel: (providerId: string, modelId: string) => {
        const normalizedProviderId = providerId.trim();
        const normalizedModelId = modelId.trim();
        if (!normalizedProviderId || !normalizedModelId) {
          return;
        }
        const nextModels = currentProviderModels(configRuntime, normalizedProviderId).filter(
          (entry) => modelEntryId(entry) !== normalizedModelId,
        );
        configCapability.updateFormValue(
          configFormState,
          ["models", "providers", normalizedProviderId, "models"],
          nextModels,
        );
      },
      onSetDefaultPrimary: (modelRef: string | null) => {
        const normalized = modelRef?.trim() ?? "";
        const basePath = ["agents", "defaults", "model"];
        if (!normalized) {
          const fallbacks = resolveDefaultFallbackValues(configRuntime);
          if (fallbacks.length > 0) {
            actionState.lastError =
              "Cannot clear the default primary while fallbacks are still configured.";
            return;
          }
          configCapability.removeFormValue(configFormState, basePath);
          return;
        }
        const existing = defaultsModelValue(configRuntime, "model");
        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
          const existingFallbacks = resolveDefaultFallbackValues(configRuntime);
          configCapability.updateFormValue(configFormState, basePath, {
            primary: normalized,
            ...(existingFallbacks.length > 0 ? { fallbacks: existingFallbacks } : {}),
          });
          return;
        }
        configCapability.updateFormValue(configFormState, basePath, normalized);
      },
      onSetDefaultFallbacks: (fallbacks: string[]) => {
        const normalized = Array.from(
          new Set(fallbacks.map((entry) => entry.trim()).filter(Boolean)),
        );
        const basePath = ["agents", "defaults", "model"];
        const primary = resolveDefaultPrimaryValue(configRuntime, "model");
        if (normalized.length === 0) {
          if (primary) {
            configCapability.updateFormValue(configFormState, basePath, primary);
          } else {
            configCapability.removeFormValue(configFormState, basePath);
          }
          return;
        }
        if (!primary) {
          actionState.lastError = "Default primary model is required before configuring fallbacks.";
          return;
        }
        configCapability.updateFormValue(configFormState, basePath, {
          primary,
          fallbacks: normalized,
        });
      },
      onSetDefaultImagePrimary: (modelRef: string | null) => {
        const normalized = modelRef?.trim() ?? "";
        const basePath = ["agents", "defaults", "imageModel"];
        if (!normalized) {
          configCapability.removeFormValue(configFormState, basePath);
          return;
        }
        configCapability.updateFormValue(configFormState, basePath, normalized);
      },
      onUpsertTaskPlanConfig: (input: PlatformTaskPlanConfigInput) => {
        const planId = input.planId.trim();
        if (!planId) {
          actionState.lastError = "Task plan ID is required.";
          return;
        }
        const nextPrimary = Array.from(
          new Set(input.primaryModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        const nextFallback = Array.from(
          new Set(input.fallbackModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        const existing = currentTaskPlanConfig(configRuntime, planId) ?? {};
        configCapability.updateFormValue(configFormState, ["models", "taskPlans", planId], {
          ...existing,
          ...(input.taskProfileId?.trim() ? { taskProfileId: input.taskProfileId.trim() } : {}),
          primaryModelIds: nextPrimary,
          fallbackModelIds: nextFallback,
          status:
            existing.status === "draft" ||
            existing.status === "published" ||
            existing.status === "deprecated"
              ? existing.status
              : "published",
          updatedAt: Date.now(),
        });
      },
      onUpsertRoutingPolicyConfig: (input: PlatformRoutingPolicyConfigInput) => {
        const policyId = input.policyId.trim();
        if (!policyId) {
          actionState.lastError = "Routing policy ID is required.";
          return;
        }
        const nextPrimary = Array.from(
          new Set(input.primaryModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        const nextFallback = Array.from(
          new Set(input.fallbackModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        const existing = currentRoutingPolicyConfig(configRuntime, policyId) ?? {};
        configCapability.updateFormValue(configFormState, ["models", "routingPolicies", policyId], {
          ...existing,
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(input.taskProfileId?.trim() ? { taskProfileId: input.taskProfileId.trim() } : {}),
          ...(input.planId?.trim() ? { planId: input.planId.trim() } : {}),
          primaryModelIds: nextPrimary,
          fallbackModelIds: nextFallback,
          status:
            input.status === "active" || input.status === "draft" || input.status === "disabled"
              ? input.status
              : existing.status === "active" ||
                  existing.status === "draft" ||
                  existing.status === "disabled"
                ? existing.status
                : "active",
          ...(input.rankingMode === "quality" ||
          input.rankingMode === "cost" ||
          input.rankingMode === "speed" ||
          input.rankingMode === "balanced"
            ? { rankingMode: input.rankingMode }
            : {}),
          ...(input.maxCostPerRequest != null
            ? { maxCostPerRequest: input.maxCostPerRequest }
            : {}),
          ...(input.maxLatencyMs != null ? { maxLatencyMs: input.maxLatencyMs } : {}),
          ...(input.requiredCapabilities?.length
            ? {
                requiredCapabilities: Array.from(
                  new Set(input.requiredCapabilities.map((entry) => entry.trim()).filter(Boolean)),
                ),
              }
            : {}),
          ...(input.requiredHealth ? { requiredHealth: input.requiredHealth } : {}),
          updatedAt: Date.now(),
        });
      },
      onDuplicateRoutingPolicyConfig: (input: PlatformRoutingPolicyConfigInput) => {
        const sourcePolicyId = input.policyId.trim();
        if (!sourcePolicyId) {
          actionState.lastError = "Routing policy ID is required.";
          return;
        }
        const policyId = uniqueRoutingPolicyId(configRuntime, sourcePolicyId);
        const primaryModelIds = Array.from(
          new Set(input.primaryModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        const fallbackModelIds = Array.from(
          new Set(input.fallbackModelIds.map((entry) => entry.trim()).filter(Boolean)),
        );
        configCapability.updateFormValue(configFormState, ["models", "routingPolicies", policyId], {
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          ...(input.taskProfileId?.trim() ? { taskProfileId: input.taskProfileId.trim() } : {}),
          ...(input.planId?.trim() ? { planId: input.planId.trim() } : {}),
          primaryModelIds,
          fallbackModelIds,
          status: "draft",
          ...(input.rankingMode ? { rankingMode: input.rankingMode } : {}),
          ...(input.maxCostPerRequest != null
            ? { maxCostPerRequest: input.maxCostPerRequest }
            : {}),
          ...(input.maxLatencyMs != null ? { maxLatencyMs: input.maxLatencyMs } : {}),
          ...(input.requiredCapabilities?.length
            ? {
                requiredCapabilities: Array.from(
                  new Set(input.requiredCapabilities.map((entry) => entry.trim()).filter(Boolean)),
                ),
              }
            : {}),
          ...(input.requiredHealth ? { requiredHealth: input.requiredHealth } : {}),
          sourcePolicyId,
          updatedAt: Date.now(),
        });
      },
      onUpdateRoutingPolicyStatus: (
        policyId: string,
        nextStatus: "active" | "draft" | "disabled",
      ) => {
        const normalizedPolicyId = policyId.trim();
        if (!normalizedPolicyId) {
          actionState.lastError = "Routing policy ID is required.";
          return;
        }
        const existing = currentRoutingPolicyConfig(configRuntime, normalizedPolicyId) ?? {};
        configCapability.updateFormValue(
          configFormState,
          ["models", "routingPolicies", normalizedPolicyId],
          {
            ...existing,
            status: nextStatus,
            updatedAt: Date.now(),
          },
        );
      },
      onUpsertAllowlistEntry: (modelRef: string, alias: string | null) => {
        const normalizedRef = modelRef.trim();
        if (!normalizedRef) {
          actionState.lastError = "Allowlist model ref is required.";
          return;
        }
        const normalizedAlias = alias?.trim() ?? "";
        const existingCatalog = defaultsModelsCatalog(configRuntime) ?? {};
        const existingEntry = asRecord(existingCatalog[normalizedRef]) ?? {};
        configCapability.updateFormValue(
          configFormState,
          ["agents", "defaults", "models", normalizedRef],
          {
            ...existingEntry,
            ...(normalizedAlias ? { alias: normalizedAlias } : {}),
          },
        );
        if (!normalizedAlias && "alias" in existingEntry) {
          configCapability.removeFormValue(configFormState, [
            "agents",
            "defaults",
            "models",
            normalizedRef,
            "alias",
          ]);
        }
      },
      onRemoveAllowlistEntry: (modelRef: string) => {
        const normalizedRef = modelRef.trim();
        if (!normalizedRef) {
          return;
        }
        configCapability.removeFormValue(configFormState, [
          "agents",
          "defaults",
          "models",
          normalizedRef,
        ]);
      },
      onSaveConfig: () => saveConfigAndRefreshModelsManagement(),
    },
    platformAgents: {
      onRefresh: () => actionState.loadOverview(),
      onRefreshFleet: () => actionState.loadOverview(),
      onRefreshDirectory: () => actionState.loadOverview(),
      onRefreshWorkspaces: () => actionState.loadOverview(),
    },
    advanced: {
      onRefresh: async () => {
        await channelsCapability.load(channelsLoadState, false);
        await presenceCapability.load(presenceLoadState);
        await loadNodes(actionState, { quiet: true });
        await loadDevices(actionState, { quiet: true });
      },
      onRefreshChannels: (probe: boolean) => channelsCapability.load(channelsLoadState, probe),
      onRefreshInstances: () => presenceCapability.load(presenceLoadState),
      onRefreshUsage: () => actionState.loadOverview(),
      onRefreshSessions: () => sessionsCapability.load(sessionsLoadState),
      onRefreshLogs: () => logsCapability.load(logsLoadState, { reset: true }),
      onPatchSession: (key: string, patch: SessionPatch) =>
        sessionsCapability.patch(sessionsManageState, key, patch),
      onDeleteSession: (key: string) =>
        sessionsCapability.deleteAndRefresh(sessionsManageState, key),
      onRefreshNodes: () => loadNodes(actionState),
      onRefreshDevices: () => loadDevices(actionState),
      onDeviceApprove: (requestId: string) => approveDevicePairing(actionState, requestId),
      onDeviceReject: (requestId: string) => rejectDevicePairing(actionState, requestId),
      onDeviceRotate: (deviceId: string, role: string, scopes?: string[]) =>
        rotateDeviceToken(actionState, { deviceId, role, scopes }),
      onDeviceRevoke: (deviceId: string, role: string) =>
        revokeDeviceToken(actionState, { deviceId, role }),
      onLoadBindingsConfig: () => actionState.handleChannelConfigReload(),
      onBindDefaultNode: (nodeId: string | null) =>
        configCapability.updateFormValue(
          configFormState,
          ["tools", "exec", "node"],
          nodeId && nodeId.trim() ? nodeId.trim() : null,
        ),
      onBindAgentNode: (agentIndex: number, nodeId: string | null) =>
        configCapability.updateFormValue(
          configFormState,
          ["agents", "list", agentIndex, "tools", "exec", "node"],
          nodeId && nodeId.trim() ? nodeId.trim() : null,
        ),
      onSaveBindings: () => configCapability.save(configSaveState),
      onLoadExecApprovals: () =>
        execApprovalsCapability.load(
          actionState,
          actionState.execApprovalsTarget === "node" &&
            actionState.execApprovalsTargetNodeId?.trim()
            ? { kind: "node", nodeId: actionState.execApprovalsTargetNodeId.trim() }
            : { kind: "gateway" },
        ),
      onExecApprovalsTargetChange: (kind: "gateway" | "node", nodeId: string | null) => {
        actionState.execApprovalsTarget = kind;
        actionState.execApprovalsTargetNodeId = kind === "node" ? (nodeId?.trim() ?? null) : null;
      },
      onExecApprovalsSelectAgent: (agentId: string) => {
        actionState.execApprovalsSelectedAgent = agentId.trim() || null;
      },
      onExecApprovalsPatch: (path: ExecApprovalsPath, value: unknown) =>
        execApprovalsCapability.updateFormValue(actionState, path, value),
      onExecApprovalsRemove: (path: ExecApprovalsPath) =>
        execApprovalsCapability.removeFormValue(actionState, path),
      onSaveExecApprovals: () =>
        execApprovalsCapability.save(
          actionState,
          actionState.execApprovalsTarget === "node" &&
            actionState.execApprovalsTargetNodeId?.trim()
            ? { kind: "node", nodeId: actionState.execApprovalsTargetNodeId.trim() }
            : { kind: "gateway" },
        ),
    },
    systemSettings: {
      onRefresh: () => actionState.loadOverview(),
      onSetPlatformModelsMode: (mode: "native" | "aor_enhanced") =>
        configCapability.updateFormValue(
          configFormState,
          ["gateway", "platform", "models", "mode"],
          mode,
        ),
      onRunUpdate: () => configCapability.runUpdate(configUpdateState),
      onSaveConfig: () => saveConfigAndRefreshModelsManagement(),
    },
    skills: {
      onRefresh: () => skillsCapability.load(skillsLoadState, { clearMessages: false }),
      onToggle: (skillKey: string, enabled: boolean) =>
        skillsCapability.updateEnabled(skillsManageState, skillKey, enabled),
      onEdit: (skillKey: string, value: string) =>
        skillsCapability.updateEdit(skillsManageState, skillKey, value),
      onSaveKey: (skillKey: string) => skillsCapability.saveApiKey(skillsManageState, skillKey),
      onInstall: (skillKey: string, name: string, installId: string) =>
        skillsCapability.install(skillsManageState, skillKey, name, installId),
    },
    channels: {
      onRefresh: (probe: boolean) => channelsCapability.load(channelsLoadState, probe),
      onWhatsAppStart: (force: boolean) => actionState.handleWhatsAppStart(force),
      onWhatsAppWait: () => actionState.handleWhatsAppWait(),
      onWhatsAppLogout: () => actionState.handleWhatsAppLogout(),
      onConfigPatch: (path: ChannelConfigPath, value: unknown) =>
        configCapability.updateFormValue(configFormState, path, value),
      onConfigSave: () => actionState.handleChannelConfigSave(),
      onConfigReload: () => actionState.handleChannelConfigReload(),
      onNostrProfileEdit: (accountId: string, profile: ChannelProfile) =>
        actionState.handleNostrProfileEdit(accountId, profile),
      onNostrProfileCancel: () => actionState.handleNostrProfileCancel(),
      onNostrProfileFieldChange: (field: ChannelProfileField, value: string) =>
        actionState.handleNostrProfileFieldChange(field, value),
      onNostrProfileSave: () => actionState.handleNostrProfileSave(),
      onNostrProfileImport: () => actionState.handleNostrProfileImport(),
      onNostrProfileToggleAdvanced: () => actionState.handleNostrProfileToggleAdvanced(),
    },
    instances: {
      onRefresh: () => presenceCapability.load(presenceLoadState),
    },
  };
}

export type PlatformPortActions = ReturnType<typeof createPlatformPortActions>;
