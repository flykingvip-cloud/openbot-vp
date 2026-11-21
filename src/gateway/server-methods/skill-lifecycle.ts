import { loadConfig } from "../../config/config.js";
import { syncRobotPendingTaskGapStatuses } from "../agent-growth/pending-task-gap-sync.js";
import { recordRobotGrowthMilestone } from "../agent-growth/record-robot-milestone.js";
import { findRegistryEntryBySkillKey, getRegistryEntry } from "../capability-governance-store.js";
import {
  listMyAccumulationSkillAssets,
  requireOwnedPersonalSkill,
  requirePersonalAssetOwner,
  resolvePersonalAssetOwnerIdentities,
  resolvePersonalAssetOwnerUserId,
} from "../personal-skill-asset-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { syncInstallToRuntime } from "../runtime-binding-sync.js";
import {
  assessSkillAvailability,
  packSkillIsNative,
  packSkillRequiresSecret,
  resolveVerbsForSkill,
} from "../skill-capability-contract.js";
import { submitSkillToEnterpriseReview } from "../skill-enterprise-submission.js";
import { ensureSkillExecutionBindingHooksRegistered } from "../skill-execution-binding/index.js";
import { recordSkillInvocationCompleted } from "../skill-invocation/index.js";
import {
  assertRobotSkillRelationScope,
  listTenantRobotSkillAssets,
} from "../skill-lifecycle-store.js";
import {
  acceptSkillAutofill,
  acceptSkillClassification,
  deletePersonalSkillAsset,
  deprecateSkillReview,
  editPersonalSkillAsset,
  extractSkillPreview,
  finalizeDraftSkill,
  getPersonalSkillAssetDetail,
  getRuntimeDependencyGraphSnapshot,
  getRuntimeDependencySummary,
  getSkillAutofillResult,
  getSkillReviewRecord,
  installSkillToRobotAsset,
  listRobotSkillAssets,
  readSkillRelationMutationReports,
  listSkillClassificationSuggestions,
  listSkillRecommendations,
  publishSkillReview,
  recordSkillHealthSample,
  removeRobotSkillAsset,
  retireSkillReview,
  saveSkillAsset,
  sharePersonalSkillToGroup,
  SkillAssetStoreError,
  startSkillAutofill,
  suggestSkillHealthRepair,
  toggleRobotSkillAsset,
  upgradeRobotSkillAsset,
  type SkillLifecycleState,
  type SkillRelationMutationHookResult,
} from "../skill-lifecycle-store.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import {
  resolvePackSkillInstallBlock,
  respondIfPackSkillReviewBlocked,
} from "./pack-skill-review-install.js";
import { optionalString, requiredString } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

function optionalLifecycle(value: unknown): SkillLifecycleState | undefined {
  if (
    value === "draft" ||
    value === "private" ||
    value === "reviewing" ||
    value === "approved" ||
    value === "published" ||
    value === "deprecated" ||
    value === "rejected" ||
    value === "retired"
  ) {
    return value;
  }
  return undefined;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
}

function assertRobotSkillInstallAllowed(agentId: string, skillId: string): void {
  const installed = listRobotSkillAssets(agentId).some((entry) => entry.id === skillId);
  let lifecycle: SkillLifecycleState | undefined;
  let name = skillId;
  let summary = "";
  let tags: string[] = [];
  let category = "";
  try {
    const detail = getPersonalSkillAssetDetail(skillId);
    lifecycle = detail.lifecycle;
    name = detail.profile.name;
    summary = detail.profile.summary;
    tags = detail.profile.tags;
    category = detail.profile.category;
  } catch {
    // Registry-only ids still resolve pack flags by skillKey.
  }
  const assessment = assessSkillAvailability({
    id: skillId,
    name,
    summary,
    tags,
    category,
    verbs: resolveVerbsForSkill({
      skillId,
      skillKey: skillId,
      name,
      summary,
      tags,
    }),
    installed,
    lifecycle,
    secrets: packSkillRequiresSecret(skillId),
    native: packSkillIsNative(skillId),
  });
  if (!assessment.installAllowed) {
    throw new SkillAssetStoreError(assessment.nextStep);
  }
}

type RuntimeBindingReport = {
  role: "auxiliary" | "not_required";
  state: "synced" | "failed" | "not_required" | "not_reviewed";
  synced: boolean;
  reason?: string;
  runtimeAgentId?: string;
  bindingId?: string;
};

function projectionFromReports(
  reports: SkillRelationMutationHookResult[],
  op: "install" | "remove",
): {
  state: "ready" | "failed" | "pending" | "absent";
  action: "materialised" | "removed" | "skipped";
  reason?: string;
  skillName?: string;
} {
  const projection = reports.find((report) => report.projection)?.projection;
  if (!projection) {
    return {
      state: "pending",
      action: "skipped",
      reason: "projection-result-not-retained",
    };
  }
  if (projection.action === "materialised") {
    return {
      state: "ready",
      action: projection.action,
      reason: projection.reason,
      skillName: projection.skillName,
    };
  }
  if (projection.action === "removed" && op === "remove") {
    return {
      state: "absent",
      action: projection.action,
      reason: projection.reason,
      skillName: projection.skillName,
    };
  }
  return {
    state: "failed",
    action: projection.action,
    reason: projection.reason,
    skillName: projection.skillName,
  };
}

async function reportRuntimeBinding(params: {
  cfg: ReturnType<typeof loadConfig>;
  userEmail: string | null;
  capabilityId: string;
}): Promise<RuntimeBindingReport> {
  try {
    const syncResult = await syncInstallToRuntime({
      cfg: params.cfg,
      userEmail: params.userEmail,
      capabilityId: params.capabilityId,
    });
    if (!params.userEmail) {
      return {
        role: "not_required",
        state: "not_required",
        synced: false,
        reason: syncResult.reason ?? "missing-user",
      };
    }
    return {
      role: "auxiliary",
      state: syncResult.synced ? "synced" : "failed",
      synced: syncResult.synced,
      reason: syncResult.reason,
      runtimeAgentId: syncResult.runtimeAgentId,
      bindingId: syncResult.bindingId,
    };
  } catch {
    return params.userEmail
      ? { role: "auxiliary", state: "failed", synced: false, reason: "sync-exception" }
      : { role: "not_required", state: "not_required", synced: false, reason: "missing-user" };
  }
}

function respondSkillError(respond: RespondFn, error: unknown): void {
  if (respondIfPackSkillReviewBlocked(respond, error)) {
    return;
  }
  if (error instanceof SkillAssetStoreError) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
}

async function loadOwnedPersonalSkill(client: GatewayClient | null, skillId: string) {
  const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
  return requireOwnedPersonalSkill({ skillId, ownerIds });
}

// Ensure install/toggle/remove materialise lifecycle skills into the agent execution projection.
ensureSkillExecutionBindingHooksRegistered();

export const skillLifecycleHandlers: GatewayRequestHandlers = {
  "skill-lifecycle.extract": ({ params, respond }) => {
    const agentId = requiredString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    respond(
      true,
      extractSkillPreview({
        agentId,
        contextId: optionalString(params, "contextId"),
      }),
      undefined,
    );
  },

  "skill-lifecycle.save": async ({ params, respond, client }) => {
    const sourceAgentId = requiredString(params, "sourceAgentId", respond);
    if (!sourceAgentId) {
      return;
    }
    if (!params.profile || typeof params.profile !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "profile is required"));
      return;
    }
    try {
      const ownerUserId = requirePersonalAssetOwner(await resolvePersonalAssetOwnerUserId(client));
      const result = saveSkillAsset({
        sourceAgentId,
        ownerUserId,
        contextId: optionalString(params, "contextId"),
        lifecycle: optionalLifecycle(params.lifecycle),
        profile: params.profile,
        runtimeDefinition: params.runtimeDefinition,
        targetGroupId: optionalString(params, "targetGroupId"),
      });
      respond(true, result, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.list": async ({ respond, client }) => {
    const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
    respond(true, { skills: listMyAccumulationSkillAssets(ownerIds) }, undefined);
  },

  "personal-skills.detail": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, await loadOwnedPersonalSkill(client, skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.edit": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    if (!params.profile || typeof params.profile !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "profile is required"));
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, skillId);
      respond(
        true,
        {
          skill: editPersonalSkillAsset({
            skillId,
            profile: params.profile,
            summary: optionalString(params, "summary") ?? undefined,
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.share": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    const groupId = requiredString(params, "groupId", respond);
    if (!skillId || !groupId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, skillId);
      respond(true, { skill: sharePersonalSkillToGroup({ skillId, groupId }) }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // Alias of employee-capability.submit-to-enterprise — same write.
  "personal-skills.submit": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, skillId);
      const submittedBy =
        typeof client?.user === "string" && client.user.trim()
          ? client.user.trim()
          : "personal-skills";
      const submitted = submitSkillToEnterpriseReview({
        skillId,
        submittedBy,
        enterpriseId: optionalString(params, "enterpriseId"),
        packageDraft: params.packageDraft,
        scope: params.scope,
      });
      respond(
        true,
        {
          skill: submitted.detail,
          capabilityId: submitted.capabilityId,
          shareVisibility: submitted.shareVisibility,
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.delete": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, skillId);
      respond(true, deletePersonalSkillAsset(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.finalize-draft": async ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      await loadOwnedPersonalSkill(client, skillId);
      respond(true, { skill: finalizeDraftSkill(skillId) }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "personal-skills.accept-autofill": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    const suggestion =
      params.suggestion && typeof params.suggestion === "object"
        ? (params.suggestion as Record<string, unknown>)
        : {};
    try {
      respond(
        true,
        {
          skill: acceptSkillAutofill({
            skillId,
            suggestion,
            acceptFields: optionalStringArray(params.acceptFields),
            acceptSummaryRefinement: params.acceptSummaryRefinement === true,
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // ── Dependency (G4) ────────────────────────────────────────────────────────
  "skill-dependency.summary": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, getRuntimeDependencySummary(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-dependency.graph": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, getRuntimeDependencyGraphSnapshot(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // ── Health (G1) ──────────────────────────────────────────────────────────
  "skill-health.sample": ({ params, respond }) => {
    const sampleRaw =
      params.sample && typeof params.sample === "object"
        ? (params.sample as Record<string, unknown>)
        : params;
    const skillId = typeof sampleRaw.skillId === "string" ? sampleRaw.skillId.trim() : "";
    if (!skillId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skillId is required"));
      return;
    }
    try {
      respond(
        true,
        {
          skill: recordSkillHealthSample({
            skillId,
            outcome: sampleRaw.outcome === "failure" ? "failure" : "success",
            latencyMs: typeof sampleRaw.latencyMs === "number" ? sampleRaw.latencyMs : 0,
            failureReason:
              typeof sampleRaw.failureReason === "string" ? sampleRaw.failureReason : undefined,
            timestamp: typeof sampleRaw.timestamp === "number" ? sampleRaw.timestamp : undefined,
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  /**
   * Record a real skill invocation (started+completed folded). Updates usage, lastInvokedAt,
   * durable event log, and health window.
   */
  "skill-invocation.record-completed": ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    const agentId = requiredString(params, "agentId", respond);
    if (!skillId || !agentId) {
      return;
    }
    // Do not default missing/illegal outcome to success (forges healthy metrics).
    if (
      params.outcome !== "success" &&
      params.outcome !== "failure" &&
      params.outcome !== "cancelled"
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "outcome must be success | failure | cancelled"),
      );
      return;
    }
    const outcome = params.outcome;
    // Prefer authenticated client identity for tenant/user when present; never invent success.
    const clientUser =
      typeof client?.user === "string" && client.user.trim() ? client.user.trim() : null;
    try {
      const event = recordSkillInvocationCompleted({
        skillId,
        agentId,
        skillVersion: optionalString(params, "skillVersion") ?? undefined,
        outcome,
        latencyMs: typeof params.latencyMs === "number" ? params.latencyMs : undefined,
        failureCategory: optionalString(params, "failureCategory"),
        runId: optionalString(params, "runId"),
        sessionKey: optionalString(params, "sessionKey"),
        tenantId: optionalString(params, "tenantId"),
        userId: optionalString(params, "userId") ?? clientUser,
        businessOutcome: optionalString(params, "businessOutcome"),
        invocationId: optionalString(params, "invocationId") ?? undefined,
      });
      respond(true, { event }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-health.repair-suggestions": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, suggestSkillHealthRepair(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // ── Autofill (G2) ──────────────────────────────────────────────────────────
  "skill-autofill.start": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, startSkillAutofill(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-autofill.result": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, getSkillAutofillResult(skillId), undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // ── Auto-classify (G5) ───────────────────────────────────────────────────
  "skill-auto-classify.suggestions": ({ respond }) => {
    respond(true, { suggestions: listSkillClassificationSuggestions() }, undefined);
  },

  "skill-auto-classify.accept": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(
        true,
        {
          skill: acceptSkillClassification({
            skillId,
            acceptCategory: optionalString(params, "acceptCategory"),
            acceptTags: optionalStringArray(params.acceptTags),
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  // ── Recommendations (G5) ───────────────────────────────────────────────────
  "skill-recommendations.list": ({ params, respond }) => {
    const agentId = requiredString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    respond(true, { recommendations: listSkillRecommendations(agentId) }, undefined);
  },

  // ── Enterprise review lifecycle (G5) ───────────────────────────────────────
  // Alias of employee-capability.submit-to-enterprise — same write; response stays G5 record.
  "skill-review.submit": ({ params, respond, client }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      const submittedBy =
        typeof client?.user === "string" && client.user.trim()
          ? client.user.trim()
          : "skill-review";
      submitSkillToEnterpriseReview({
        skillId,
        submittedBy,
        enterpriseId: optionalString(params, "enterpriseId"),
        packageDraft: params.packageDraft,
        scope: params.scope,
      });
      const record = getSkillReviewRecord(skillId);
      if (!record) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "review record missing"));
        return;
      }
      respond(true, record, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-review.record": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    const record = getSkillReviewRecord(skillId);
    if (!record) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "review record not found"));
      return;
    }
    respond(true, record, undefined);
  },

  // G5 rematerialize only after enterprise registry approval. This must not
  // become a second approve/register write.
  "skill-review.publish": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      if (!findRegistryEntryBySkillKey(skillId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "skill-review.publish rematerializes an already-approved enterprise skill; approve via enterprise-capability.review",
          ),
        );
        return;
      }
      respond(true, { skill: publishSkillReview({ skillId, scope: params.scope }) }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-review.deprecate": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, { skill: deprecateSkillReview(skillId) }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "skill-review.retire": ({ params, respond }) => {
    const skillId = requiredString(params, "skillId", respond);
    if (!skillId) {
      return;
    }
    try {
      respond(true, { skill: retireSkillReview(skillId) }, undefined);
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "robot-skills.list": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    try {
      const authority = await resolveAuthoritativeMembership(client);
      if (!authority.tenantId || !authority.userId) {
        throw new Error("Robot skills require authoritative tenant membership");
      }
      respond(
        true,
        {
          skills: listTenantRobotSkillAssets({
            tenantId: authority.tenantId,
            userId: authority.userId,
            agentId,
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "robot-skills.toggle": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    const skillId = requiredString(params, "skillId", respond);
    if (!agentId || !skillId) {
      return;
    }
    if (typeof params.enabled !== "boolean") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "enabled is required"));
      return;
    }
    try {
      const authority = await resolveAuthoritativeMembership(client);
      if (!authority.tenantId || !authority.userId) {
        throw new Error("Robot skill mutation requires authoritative tenant membership");
      }
      assertRobotSkillRelationScope({
        tenantId: authority.tenantId,
        userId: authority.userId,
        agentId,
        skillId,
      });
      respond(
        true,
        {
          skill: toggleRobotSkillAsset({
            agentId,
            skillId,
            enabled: params.enabled,
            scope: { tenantId: authority.tenantId, userId: authority.userId },
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "robot-skills.upgrade": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    const skillId = requiredString(params, "skillId", respond);
    if (!agentId || !skillId) {
      return;
    }
    try {
      const authority = await resolveAuthoritativeMembership(client);
      if (!authority.tenantId || !authority.userId) {
        throw new Error("Robot skill mutation requires authoritative tenant membership");
      }
      assertRobotSkillRelationScope({
        tenantId: authority.tenantId,
        userId: authority.userId,
        agentId,
        skillId,
      });
      respond(
        true,
        {
          skill: upgradeRobotSkillAsset({
            agentId,
            skillId,
            scope: { tenantId: authority.tenantId, userId: authority.userId },
          }),
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "robot-skills.remove": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    const skillId = requiredString(params, "skillId", respond);
    if (!agentId || !skillId) {
      return;
    }
    try {
      const authority = await resolveAuthoritativeMembership(client);
      if (!authority.tenantId || !authority.userId) {
        throw new Error("Robot skill mutation requires authoritative tenant membership");
      }
      assertRobotSkillRelationScope({
        tenantId: authority.tenantId,
        userId: authority.userId,
        agentId,
        skillId,
      });
      const removed = removeRobotSkillAsset({
        agentId,
        skillId,
        scope: { tenantId: authority.tenantId, userId: authority.userId },
      });
      const projection = projectionFromReports(readSkillRelationMutationReports(removed), "remove");
      respond(
        true,
        {
          ok: true,
          relation: { state: "absent" },
          projection,
          runtimeBinding: { role: "not_required", state: "not_reviewed", synced: false },
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },

  "robot-skills.install": async ({ params, respond, client }) => {
    const agentId = requiredString(params, "agentId", respond);
    const skillId = requiredString(params, "skillId", respond);
    if (!agentId || !skillId) {
      return;
    }
    try {
      const reviewBlock = await resolvePackSkillInstallBlock({
        client,
        capabilityId: skillId,
        targetRobotId: agentId,
      });
      if (reviewBlock) {
        throw reviewBlock;
      }
      const registryEntry = getRegistryEntry(skillId) ?? findRegistryEntryBySkillKey(skillId);
      if (registryEntry) {
        try {
          getPersonalSkillAssetDetail(skillId);
        } catch {
          saveSkillAsset({
            skillId,
            sourceAgentId: agentId,
            ownerUserId: await resolvePersonalAssetOwnerUserId(client),
            contextId: `enterprise-capability:${registryEntry.manifest.id}`,
            lifecycle: "published",
            profile: {
              name: registryEntry.manifest.name,
              summary: registryEntry.manifest.descriptionZh ?? registryEntry.manifest.description,
              assetType: "capability",
              usageExamples: ["来自企业岗位能力市场，可安装到适配机器人"],
              inputDescription: "按能力说明输入业务素材",
              outputDescription: "输出结构化处理结果",
              tags: ["企业能力", "岗位推送"],
              category:
                typeof registryEntry.manifest.categoryId === "string"
                  ? registryEntry.manifest.categoryId
                  : "企业能力",
              visibility: "enterprise",
            },
            enterpriseConsumers: [
              {
                consumerId: registryEntry.manifest.id,
                name: "企业岗位能力市场",
                type: "position-market",
              },
            ],
          });
        }
      }
      assertRobotSkillInstallAllowed(agentId, skillId);
      const authority = await resolveAuthoritativeMembership(client);
      if (!authority.tenantId || !authority.userId) {
        throw new Error("Skill install requires authoritative tenant membership");
      }
      const skill = installSkillToRobotAsset({
        agentId,
        skillId,
        ...(authority.tenantId && authority.userId
          ? { tenantId: authority.tenantId, ownerUserId: authority.userId }
          : {}),
      });
      const projection = projectionFromReports(readSkillRelationMutationReports(skill), "install");
      const cfg = loadConfig();
      // P0 onboarding：技能真实安装成功才写里程碑（FWW）。
      void recordRobotGrowthMilestone(cfg, agentId, "firstSkillInstalledAtMs").catch(() => {});
      void syncRobotPendingTaskGapStatuses(cfg, agentId).catch(() => {});
      const userEmail =
        typeof client?.user === "string" && client.user.trim()
          ? client.user.trim()
          : typeof client?.connect === "object" &&
              client.connect &&
              "user" in (client.connect as Record<string, unknown>) &&
              typeof (client.connect as Record<string, unknown>).user === "string"
            ? String((client.connect as Record<string, unknown>).user)
            : null;
      const runtimeBinding = await reportRuntimeBinding({ cfg, userEmail, capabilityId: skillId });
      respond(
        true,
        {
          skill,
          relation: { state: "linked" },
          projection,
          runtimeBinding,
        },
        undefined,
      );
    } catch (error) {
      respondSkillError(respond, error);
    }
  },
};
