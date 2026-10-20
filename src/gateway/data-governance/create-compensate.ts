import type { OpenBotConfig } from "../../config/types.js";
import { emitAccessGovernanceAudit } from "../access-control/audit-sink.js";
import { releasePrimaryOwner } from "../agent-registry/ownership.js";
import { loadAgentRegistryStore, saveAgentRegistryStore } from "../agent-registry/store.js";
import { revokeOwnershipRecord } from "../ownership-store.js";
import { unbindAgentAssetFromSeatForTenant } from "../platform-auth/seat-store-loader.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import {
  abortAgentGovernanceRegistration,
  markCatalogRecoveryRequired,
  type AbortGovernanceResult,
} from "./runtime-catalog.js";

export type CompensateAgentCreateParams = {
  operationId: string;
  reason: string;
  agentId: string;
  stateDir?: string;
  /** Prior config snapshot taken before writeConfigFile(nextConfig). */
  configSnapshot: OpenBotConfig;
  configWritten: boolean;
  writeConfigFile: (cfg: OpenBotConfig) => Promise<void>;
  ownershipBound: boolean;
  seatBound: boolean;
  registrySaved: boolean;
  registryAssetId: string | null;
  tenantId: string | null;
  ownerUserId: string | null;
  ownerUserLabel: string | null;
  ownerPositionId: string | null;
  governanceIds: { agentResourceId: string; workspaceResourceId: string } | null;
  workspaceLocator: string;
  agentDirLocator: string;
  transcriptsDir?: string;
  allowedRoots: string[];
  /** Optional overrides for tests / DI. */
  unbindSeat?: typeof unbindAgentAssetFromSeatForTenant;
  releaseRegistry?: (params: CompensateAgentCreateParams) => Promise<void>;
  revokeOwnership?: typeof revokeOwnershipRecord;
  writeReceipt?: typeof writeGovernanceRecoveryReceipt;
  markRecovery?: typeof markCatalogRecoveryRequired;
  abortRegistration?: typeof abortAgentGovernanceRegistration;
};

export type CompensateAgentCreateResult = {
  ok: boolean;
  /** True when config restore failed — subsequent destructive steps were skipped. */
  haltedAtConfigRestore: boolean;
  recoveryRequired: boolean;
  stage: string;
  failedStages: string[];
  abort?: AbortGovernanceResult;
  /**
   * When registry create is compensated, the AgentAsset is retained as an archived
   * compensating tombstone (audit trail), not hard-deleted.
   */
  registryCompensatingTombstoneId?: string | null;
};

type ReceiptInput = Parameters<typeof writeGovernanceRecoveryReceipt>[0];

async function defaultReleaseRegistry(params: CompensateAgentCreateParams): Promise<void> {
  if (!params.registrySaved || !params.registryAssetId || !params.tenantId) {
    return;
  }
  const nowIso = new Date().toISOString();
  const registry = await loadAgentRegistryStore();
  const ref = {
    enterpriseId: params.tenantId,
    agentAssetId: params.registryAssetId,
  };
  // Compensating tombstone: archive + close owners. Registry has no hard-delete;
  // aborted creates remain as archived assets for audit reconstruction.
  releasePrimaryOwner({
    store: registry,
    ref,
    nowIso,
    reason: "asset_archived",
    assetStatus: "archived",
  });
  await saveAgentRegistryStore(registry);
  await emitAccessGovernanceAudit({
    ts: nowIso,
    enterpriseId: params.tenantId,
    action: "ownership.release",
    actor: {
      subjectType: "membership",
      subjectId: params.ownerUserId ?? "system",
    },
    target: {
      agentAssetId: params.registryAssetId,
      ownerType: "seat",
      ownerId: params.ownerPositionId ?? undefined,
    },
    detail: {
      reason: params.reason,
      operationId: params.operationId,
      compensate: true,
      compensatingTombstone: true,
      abortCreate: true,
    },
  });
}

function safeWriteReceipt(
  writeReceipt: typeof writeGovernanceRecoveryReceipt,
  input: ReceiptInput,
  failedStages: string[],
): void {
  try {
    writeReceipt(input);
  } catch (err) {
    failedStages.push(`receipt:${input.stage}`);
    // Last-resort: never throw from compensate. Disk may be read-only.
    void err;
  }
}

/**
 * Production compensation for failed agents.create.
 * Config restore failure halts all further compensation and writes recovery_required.
 * Any later sub-step failure accumulates recoveryRequired and keeps catalog there.
 * This function must not throw: receipt / catalog / abort failures are absorbed into failedStages.
 */
export async function compensateAgentCreateFailure(
  params: CompensateAgentCreateParams,
): Promise<CompensateAgentCreateResult> {
  const failedStages: string[] = [];
  const unbindSeat = params.unbindSeat ?? unbindAgentAssetFromSeatForTenant;
  const releaseRegistry = params.releaseRegistry ?? defaultReleaseRegistry;
  const revokeOwnership = params.revokeOwnership ?? revokeOwnershipRecord;
  const writeReceipt = params.writeReceipt ?? writeGovernanceRecoveryReceipt;
  const markRecovery = params.markRecovery ?? markCatalogRecoveryRequired;
  const abortRegistration = params.abortRegistration ?? abortAgentGovernanceRegistration;

  try {
    if (params.configWritten) {
      try {
        await params.writeConfigFile(params.configSnapshot);
      } catch (restoreErr) {
        safeWriteReceipt(
          writeReceipt,
          {
            operationId: params.operationId,
            stage: "config_restore",
            reason: params.reason,
            error: String((restoreErr as Error)?.message ?? restoreErr),
            agentId: params.agentId,
            resourceIds: params.governanceIds
              ? [params.governanceIds.agentResourceId, params.governanceIds.workspaceResourceId]
              : undefined,
            haltCompensation: true,
            stateDir: params.stateDir,
          },
          failedStages,
        );
        if (params.governanceIds) {
          try {
            await markRecovery({
              resourceIds: [
                params.governanceIds.agentResourceId,
                params.governanceIds.workspaceResourceId,
              ],
              stateDir: params.stateDir,
            });
          } catch (markErr) {
            failedStages.push("catalog_mark_recovery");
            safeWriteReceipt(
              writeReceipt,
              {
                operationId: params.operationId,
                stage: "catalog_mark_recovery",
                reason: params.reason,
                error: String((markErr as Error)?.message ?? markErr),
                agentId: params.agentId,
                haltCompensation: true,
                stateDir: params.stateDir,
              },
              failedStages,
            );
          }
        }
        return {
          ok: false,
          haltedAtConfigRestore: true,
          recoveryRequired: true,
          stage: "config_restore",
          failedStages: ["config_restore", ...failedStages.filter((s) => s !== "config_restore")],
        };
      }
    }

    if (params.seatBound && params.tenantId && params.ownerPositionId && params.ownerUserId) {
      try {
        await unbindSeat({
          tenantId: params.tenantId,
          seatId: params.ownerPositionId,
          agentId: params.agentId,
          actorUserId: params.ownerUserId,
        });
      } catch (err) {
        failedStages.push("seat_unbind");
        safeWriteReceipt(
          writeReceipt,
          {
            operationId: params.operationId,
            stage: "seat_unbind",
            reason: params.reason,
            error: String((err as Error)?.message ?? err),
            agentId: params.agentId,
            haltCompensation: false,
            stateDir: params.stateDir,
          },
          failedStages,
        );
      }
    }

    let registryCompensatingTombstoneId: string | null = null;
    if (params.registrySaved && params.registryAssetId && params.tenantId) {
      try {
        await releaseRegistry(params);
        registryCompensatingTombstoneId = params.registryAssetId;
      } catch (err) {
        failedStages.push("registry_release");
        safeWriteReceipt(
          writeReceipt,
          {
            operationId: params.operationId,
            stage: "registry_release",
            reason: params.reason,
            error: String((err as Error)?.message ?? err),
            agentId: params.agentId,
            haltCompensation: false,
            stateDir: params.stateDir,
          },
          failedStages,
        );
      }
    }

    if (params.ownershipBound && params.tenantId && params.ownerUserId) {
      try {
        revokeOwnership({
          tenantId: params.tenantId,
          subjectKind: "agent",
          subjectId: params.agentId,
          revokedByUserId: params.ownerUserId,
          revokedByUserLabel: params.ownerUserLabel ?? params.ownerUserId,
          notes: `agents.create compensate:${params.reason}`,
        });
      } catch (err) {
        failedStages.push("ownership_revoke");
        safeWriteReceipt(
          writeReceipt,
          {
            operationId: params.operationId,
            stage: "ownership_revoke",
            reason: params.reason,
            error: String((err as Error)?.message ?? err),
            agentId: params.agentId,
            haltCompensation: false,
            stateDir: params.stateDir,
          },
          failedStages,
        );
      }
    }

    const sideEffectsFailed = failedStages.length > 0;
    let abort: AbortGovernanceResult | undefined;
    if (params.governanceIds) {
      try {
        abort = await abortRegistration({
          ...params.governanceIds,
          workspaceLocator: params.workspaceLocator,
          agentDirLocator: params.agentDirLocator,
          transcriptsDir: params.transcriptsDir,
          reason: params.reason,
          operationId: params.operationId,
          allowedRoots: params.allowedRoots,
          stateDir: params.stateDir,
          finalizeLifecycle: sideEffectsFailed ? "recovery_required" : "quarantined",
        });
      } catch (abortErr) {
        failedStages.push("abort_quarantine");
        safeWriteReceipt(
          writeReceipt,
          {
            operationId: params.operationId,
            stage: "abort_quarantine",
            reason: params.reason,
            error: String((abortErr as Error)?.message ?? abortErr),
            agentId: params.agentId,
            resourceIds: [
              params.governanceIds.agentResourceId,
              params.governanceIds.workspaceResourceId,
            ],
            haltCompensation: false,
            stateDir: params.stateDir,
          },
          failedStages,
        );
        try {
          await markRecovery({
            resourceIds: [
              params.governanceIds.agentResourceId,
              params.governanceIds.workspaceResourceId,
            ],
            stateDir: params.stateDir,
          });
        } catch (markErr) {
          failedStages.push("catalog_mark_recovery");
          safeWriteReceipt(
            writeReceipt,
            {
              operationId: params.operationId,
              stage: "catalog_mark_recovery",
              reason: params.reason,
              error: String((markErr as Error)?.message ?? markErr),
              agentId: params.agentId,
              haltCompensation: false,
              stateDir: params.stateDir,
            },
            failedStages,
          );
        }
        return {
          ok: false,
          haltedAtConfigRestore: false,
          recoveryRequired: true,
          stage: failedStages.join("+"),
          failedStages,
          registryCompensatingTombstoneId,
        };
      }
      if (abort.recoveryRequired || sideEffectsFailed) {
        return {
          ok: false,
          haltedAtConfigRestore: false,
          recoveryRequired: true,
          stage: sideEffectsFailed ? failedStages.join("+") : "quarantine",
          failedStages: sideEffectsFailed ? failedStages : [...failedStages, "quarantine"],
          abort,
          registryCompensatingTombstoneId,
        };
      }
    } else if (sideEffectsFailed) {
      return {
        ok: false,
        haltedAtConfigRestore: false,
        recoveryRequired: true,
        stage: failedStages.join("+"),
        failedStages,
        registryCompensatingTombstoneId,
      };
    }

    return {
      ok: true,
      haltedAtConfigRestore: false,
      recoveryRequired: false,
      stage: "complete",
      failedStages: [],
      abort,
      registryCompensatingTombstoneId,
    };
  } catch (outerErr) {
    // Absolute last resort — compensate must never reject callers.
    failedStages.push("compensate_outer");
    safeWriteReceipt(
      writeReceipt,
      {
        operationId: params.operationId,
        stage: "compensate_outer",
        reason: params.reason,
        error: String((outerErr as Error)?.message ?? outerErr),
        agentId: params.agentId,
        haltCompensation: true,
        stateDir: params.stateDir,
      },
      failedStages,
    );
    if (params.governanceIds) {
      try {
        await markRecovery({
          resourceIds: [
            params.governanceIds.agentResourceId,
            params.governanceIds.workspaceResourceId,
          ],
          stateDir: params.stateDir,
        });
      } catch {
        failedStages.push("catalog_mark_recovery");
      }
    }
    return {
      ok: false,
      haltedAtConfigRestore: false,
      recoveryRequired: true,
      stage: "compensate_outer",
      failedStages,
    };
  }
}
