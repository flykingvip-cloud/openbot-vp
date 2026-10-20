import type {
  AgentLearningAsset,
  GroupMemoryCapsule,
  LearningProjection,
} from "@openbot/collaboration-core";
import { DefaultLearningPromotionService } from "@openbot/collaboration-runtime";
import {
  capsuleEligibilityFromStoredFields,
  type CapsuleObservationEligibility,
  type ApplyEvolutionInput,
  type EvolutionAdapter,
  type EvolutionApplication,
  type EvolutionTarget,
  type RollbackResult,
  type TargetSnapshot,
  type ValidationResult,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../../config/config.js";
import { readLearningAssetApplicationCounts } from "../../collaboration-learning/learning-asset-application-store.js";
import { createWorkspaceCollaborationStores } from "../../collaboration-learning/shared.js";
import { observationsFromCohort } from "../observation-cohort.js";
import { loadAdapterSnapshots, saveAdapterSnapshots } from "../persistent-store.js";

export type CapsuleClusterRecurrence = {
  clusterRef: string;
  occurredAt: number;
  recurred: boolean;
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
};

export function capsuleObservationEligibility(
  capsule: GroupMemoryCapsule,
): CapsuleObservationEligibility {
  return capsuleEligibilityFromStoredFields({
    metadata: capsule.metadata ?? null,
    structuredContent: capsule.structuredContent ?? null,
  });
}

function capsuleRecurred(capsule: GroupMemoryCapsule): boolean {
  if (capsule.capsuleType === "anti_pattern") {
    return true;
  }
  const outcome = capsule.structuredContent?.outcome;
  if (outcome === "failure" || outcome === "failed") {
    return true;
  }
  return capsule.structuredContent?.recurred === true;
}

function metadataFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function deriveCapsuleClusterRecurrences(
  capsules: readonly GroupMemoryCapsule[],
  capsuleId: string,
): CapsuleClusterRecurrence[] {
  const original = capsules.find((row) => row.capsuleId === capsuleId);
  if (!original) {
    return [];
  }
  const originalEligibility = capsuleObservationEligibility(original);
  if (!originalEligibility.eligible) {
    // Legacy capsules without failureClusterRef cannot compute recurrence.
    return [];
  }
  const clusterRef = originalEligibility.failureClusterRef;
  const originalAt = original.createdAt ?? 0;
  const later = capsules.filter((row) => {
    if (row.capsuleId === capsuleId) {
      return false;
    }
    const laterEligibility = capsuleObservationEligibility(row);
    return (
      laterEligibility.eligible &&
      laterEligibility.failureClusterRef === clusterRef &&
      (row.createdAt ?? 0) >= originalAt
    );
  });
  return later.map((row) => ({
    clusterRef,
    occurredAt: row.createdAt ?? row.updatedAt ?? 0,
    recurred: capsuleRecurred(row),
    securityViolation: metadataFlag(row.metadata?.securityViolation),
    crossTenantContamination: metadataFlag(row.metadata?.crossTenantContamination),
  }));
}

export type CapsuleCandidate = {
  groupId: string;
  capsuleId: string;
  targetBotId: string;
  candidateVersion: string;
};

export type CapsuleAdapterStore = {
  readCapsules(groupId: string): Promise<GroupMemoryCapsule[]>;
  writeCapsules(groupId: string, capsules: GroupMemoryCapsule[]): Promise<void>;
  readProjections(groupId: string): Promise<LearningProjection[]>;
  writeProjections(groupId: string, projections: LearningProjection[]): Promise<void>;
  readLearningAssets(groupId: string): Promise<AgentLearningAsset[]>;
  writeLearningAssets(groupId: string, assets: AgentLearningAsset[]): Promise<void>;
  readApplicationCounts(groupId: string): Promise<Record<string, number>>;
  listClusterRecurrences?(groupId: string, capsuleId: string): Promise<CapsuleClusterRecurrence[]>;
};

type CapsuleRollbackSnapshot = {
  groupId: string;
  projectionId: string;
  assetId: string;
};

function isKnowledgeTarget(
  target: EvolutionTarget,
): target is { domain: "knowledge"; assetId: string } {
  return target.domain === "knowledge";
}

function capsuleVersion(capsule: GroupMemoryCapsule): string {
  return `capsule:${capsule.status ?? "candidate"}:${capsule.updatedAt ?? capsule.createdAt ?? 0}:${capsule.reusability ?? "group_only"}`;
}

export function createMemoryCapsuleStore(
  seed: GroupMemoryCapsule[] = [],
  options?: { recurrences?: Record<string, CapsuleClusterRecurrence[]> },
): CapsuleAdapterStore {
  const capsules = new Map<string, GroupMemoryCapsule[]>();
  const projections = new Map<string, LearningProjection[]>();
  const assets = new Map<string, AgentLearningAsset[]>();
  const counts = new Map<string, Record<string, number>>();
  const recurrences = new Map(Object.entries(options?.recurrences ?? {}));
  for (const capsule of seed) {
    const list = capsules.get(capsule.groupId) ?? [];
    list.push(capsule);
    capsules.set(capsule.groupId, list);
  }
  return {
    async readCapsules(groupId) {
      return [...(capsules.get(groupId) ?? [])];
    },
    async writeCapsules(groupId, next) {
      capsules.set(groupId, [...next]);
    },
    async readProjections(groupId) {
      return [...(projections.get(groupId) ?? [])];
    },
    async writeProjections(groupId, next) {
      projections.set(groupId, [...next]);
    },
    async readLearningAssets(groupId) {
      return [...(assets.get(groupId) ?? [])];
    },
    async writeLearningAssets(groupId, next) {
      assets.set(groupId, [...next]);
    },
    async readApplicationCounts(groupId) {
      return { ...counts.get(groupId) };
    },
    async listClusterRecurrences(groupId, capsuleId) {
      const seeded = recurrences.get(`${groupId}/${capsuleId}`);
      if (seeded) {
        return [...seeded];
      }
      return deriveCapsuleClusterRecurrences(capsules.get(groupId) ?? [], capsuleId);
    },
  };
}

export function createWorkspaceCapsuleStore(cfg?: OpenBotConfig): CapsuleAdapterStore {
  const { learningStorage } = createWorkspaceCollaborationStores(cfg);
  return {
    readCapsules: (groupId) => learningStorage.readCapsules(groupId),
    writeCapsules: (groupId, capsules) => learningStorage.writeCapsules(groupId, capsules),
    readProjections: (groupId) => learningStorage.readProjections(groupId),
    writeProjections: (groupId, projections) =>
      learningStorage.writeProjections(groupId, projections),
    readLearningAssets: (groupId) => learningStorage.readLearningAssets(groupId),
    writeLearningAssets: (groupId, assets) => learningStorage.writeLearningAssets(groupId, assets),
    readApplicationCounts: (groupId) => readLearningAssetApplicationCounts(groupId),
    async listClusterRecurrences(groupId, capsuleId) {
      return deriveCapsuleClusterRecurrences(
        await learningStorage.readCapsules(groupId),
        capsuleId,
      );
    },
  };
}

export function createCapsuleEligibilityReader(
  store: CapsuleAdapterStore,
): (assetId: string) => Promise<CapsuleObservationEligibility> {
  return async (assetId) => {
    const [groupId, capsuleId] = assetId.split("/");
    if (!groupId || !capsuleId) {
      return { eligible: false, reason: "insufficient_lineage" };
    }
    const rows = await store.readCapsules(groupId);
    const capsule = rows.find((row) => row.capsuleId === capsuleId);
    if (!capsule) {
      return { eligible: false, reason: "insufficient_lineage" };
    }
    return capsuleObservationEligibility(capsule);
  };
}

export function createCapsuleAdapter(
  store: CapsuleAdapterStore,
  options?: { persistDir?: string },
): EvolutionAdapter<CapsuleCandidate> {
  const loaded = loadAdapterSnapshots(options?.persistDir, "capsule", {
    snapshots: {} as Record<string, CapsuleRollbackSnapshot>,
  });
  const applied = new Map(Object.entries(loaded.applied));
  const snapshots = new Map(Object.entries(loaded.extras.snapshots));
  const persist = () =>
    saveAdapterSnapshots(options?.persistDir, "capsule", {
      applied: Object.fromEntries(applied),
      extras: { snapshots: Object.fromEntries(snapshots) },
    });

  const loadCapsule = async (
    groupId: string,
    capsuleId: string,
  ): Promise<GroupMemoryCapsule | undefined> => {
    const rows = await store.readCapsules(groupId);
    return rows.find((row) => row.capsuleId === capsuleId);
  };

  return {
    adapterId: "capsule",
    domain: "knowledge",

    async inspect(target): Promise<TargetSnapshot> {
      if (!isKnowledgeTarget(target)) {
        throw new Error("capsule adapter requires a knowledge target");
      }
      const [groupId, capsuleId] = target.assetId.split("/");
      const capsule = groupId && capsuleId ? await loadCapsule(groupId, capsuleId) : undefined;
      return {
        target,
        version: capsule ? capsuleVersion(capsule) : "missing",
        surfaceId: "knowledge.experience-capsule",
        sourceOfTruth: "src/gateway/collaboration-learning/capsule-governance.ts",
      };
    },

    async validate(candidate, context): Promise<ValidationResult> {
      if (!isKnowledgeTarget(context.proposal.target)) {
        return { ok: false, code: "target_mismatch", reason: "proposal target is not knowledge" };
      }
      if (context.proposal.surfaceId !== "knowledge.experience-capsule") {
        return {
          ok: false,
          code: "surface_mismatch",
          reason: "capsule adapter cannot widen surface",
        };
      }
      const expectedAssetId = `${candidate.groupId}/${candidate.capsuleId}`;
      if (context.proposal.target.assetId !== expectedAssetId) {
        return {
          ok: false,
          code: "target_mismatch",
          reason: "candidate capsule does not match proposal target",
        };
      }
      const capsule = await loadCapsule(candidate.groupId, candidate.capsuleId);
      if (!capsule) {
        return { ok: false, code: "not_found", reason: "capsule not found" };
      }
      if ((capsule.status ?? "candidate") !== "approved") {
        return {
          ok: false,
          code: "content_governance_required",
          reason: "capsule apply requires content approval; approval is not VERIFIED",
        };
      }
      return { ok: true };
    },

    async apply(input: ApplyEvolutionInput<CapsuleCandidate>): Promise<EvolutionApplication> {
      const existing = applied.get(input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const validation = await this.validate(input.candidate, input.context);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const capsule = await loadCapsule(input.candidate.groupId, input.candidate.capsuleId);
      if (!capsule) {
        throw new Error("capsule not found");
      }
      if (input.scope === "shadow") {
        const shadow: EvolutionApplication = {
          schemaVersion: 1,
          applicationId: `app:${input.idempotencyKey}`,
          proposalId: input.context.proposal.proposalId,
          experimentId: input.context.experiment.experimentId,
          adapterId: "capsule",
          idempotencyKey: input.idempotencyKey,
          targetVersionBefore: capsuleVersion(capsule),
          targetVersionAfter: capsuleVersion(capsule),
          rollbackRef: `rollback:${input.idempotencyKey}`,
          scope: "shadow",
          status: "applied",
          appliedToRuntime: false,
          appliedAt: new Date().toISOString(),
        };
        applied.set(input.idempotencyKey, shadow);
        persist();
        return shadow;
      }
      const beforeVersion = capsuleVersion(capsule);
      const promotion = new DefaultLearningPromotionService({
        createProjectionId: () => `proj:${input.idempotencyKey}`,
        createAssetId: () => `asset:${input.idempotencyKey}`,
        saveProjection: async (projection) => {
          const rows = await store.readProjections(input.candidate.groupId);
          await store.writeProjections(input.candidate.groupId, [...rows, projection]);
        },
        saveLearningAsset: async (asset) => {
          const rows = await store.readLearningAssets(input.candidate.groupId);
          await store.writeLearningAssets(input.candidate.groupId, [...rows, asset]);
        },
      });
      const projected = await promotion.projectCapsule({
        groupId: input.candidate.groupId,
        capsule,
        targetBotId: input.candidate.targetBotId,
        actor: { actorId: input.candidate.targetBotId, actorKind: "operator" },
        approvalMode: "approved",
      });
      if (!projected.allowed || !projected.projection) {
        throw new Error(projected.reason);
      }
      const promoted = await promotion.promoteProjection({
        projection: projected.projection,
        capsule,
        actor: { actorId: input.candidate.targetBotId, actorKind: "operator" },
      });
      if (!promoted.promoted || !promoted.asset) {
        throw new Error(promoted.reason);
      }
      const after = await loadCapsule(input.candidate.groupId, input.candidate.capsuleId);
      const application: EvolutionApplication = {
        schemaVersion: 1,
        applicationId: `app:${input.idempotencyKey}`,
        proposalId: input.context.proposal.proposalId,
        experimentId: input.context.experiment.experimentId,
        adapterId: "capsule",
        idempotencyKey: input.idempotencyKey,
        targetVersionBefore: beforeVersion,
        targetVersionAfter: after ? capsuleVersion(after) : beforeVersion,
        rollbackRef: `rollback:${projected.projection.projectionId}:${promoted.asset.assetId}`,
        scope: input.scope,
        status: "applied",
        appliedToRuntime: true,
        appliedAt: new Date().toISOString(),
      };
      snapshots.set(application.rollbackRef, {
        groupId: input.candidate.groupId,
        projectionId: projected.projection.projectionId,
        assetId: promoted.asset.assetId,
      });
      applied.set(input.idempotencyKey, application);
      persist();
      return application;
    },

    async observeTarget(target, windowRef, window) {
      if (!isKnowledgeTarget(target) || !window) {
        return [];
      }
      const [groupId, capsuleId] = target.assetId.split("/");
      if (!groupId || !capsuleId) {
        return [];
      }
      const startedAt = Date.parse(window.startedAt);
      const endedAt = Date.parse(window.endedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
        return [];
      }
      const capsule = await loadCapsule(groupId, capsuleId);
      if (!capsule || !capsuleObservationEligibility(capsule).eligible) {
        return [];
      }
      const recurrences = (await store.listClusterRecurrences?.(groupId, capsuleId)) ?? [];
      const inWindow = recurrences.filter(
        (row) => row.occurredAt >= startedAt && row.occurredAt <= endedAt,
      );
      return observationsFromCohort({
        events: inWindow.map((row) => ({
          occurredAt: row.occurredAt,
          succeeded: !row.recurred,
          securityViolation: row.securityViolation,
          crossTenantContamination: row.crossTenantContamination,
        })),
        windowRef,
        primary: {
          metricId: "issue_recurrence_rate",
          value: (rows) => rows.filter((row) => !row.succeeded).length / rows.length,
        },
      });
    },

    async observe(input) {
      const snapshot = snapshots.get(input.application.rollbackRef);
      if (!snapshot) {
        return [];
      }
      const assets = await store.readLearningAssets(snapshot.groupId);
      const asset = assets.find((row) => row.assetId === snapshot.assetId);
      if (!asset) {
        return [];
      }
      return (
        this.observeTarget?.(
          { domain: "knowledge", assetId: `${snapshot.groupId}/${asset.sourceCapsuleId}` },
          input.windowRef,
          input.window,
        ) ?? []
      );
    },

    async rollback(application: EvolutionApplication): Promise<RollbackResult> {
      if (application.scope === "shadow") {
        const rolled: EvolutionApplication = { ...application, status: "rolled_back" };
        applied.set(application.idempotencyKey, rolled);
        persist();
        return {
          applicationId: application.applicationId,
          status: "rolled_back",
          restoredVersion: application.targetVersionBefore,
        };
      }
      const snapshot = snapshots.get(application.rollbackRef);
      if (!snapshot) {
        return {
          applicationId: application.applicationId,
          status: "failed",
          restoredVersion: application.targetVersionBefore,
          reason: "rollback snapshot missing",
        };
      }
      const projections = await store.readProjections(snapshot.groupId);
      await store.writeProjections(
        snapshot.groupId,
        projections.map((row) =>
          row.projectionId === snapshot.projectionId
            ? {
                ...row,
                approvalStatus: "revoked",
                revokedAt: Date.now(),
                revokeReason: "evolution_application_rollback",
                updatedAt: Date.now(),
              }
            : row,
        ),
      );
      const assets = await store.readLearningAssets(snapshot.groupId);
      await store.writeLearningAssets(
        snapshot.groupId,
        assets.map((row) =>
          row.assetId === snapshot.assetId
            ? { ...row, status: "revoked", updatedAt: Date.now() }
            : row,
        ),
      );
      const rolled: EvolutionApplication = { ...application, status: "rolled_back" };
      applied.set(application.idempotencyKey, rolled);
      persist();
      return {
        applicationId: application.applicationId,
        status: "rolled_back",
        restoredVersion: application.targetVersionBefore,
      };
    },
  };
}
