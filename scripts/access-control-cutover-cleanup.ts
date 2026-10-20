#!/usr/bin/env node
/**
 * Retires the data that makes an enforcement cutover misreport, in the two classes the
 * granted-surface comparison found in real tenant data:
 *
 *  --builtin-artifacts   a universal builtin modelled as an enterprise asset: archive the
 *                        asset, close its owner binding, revoke the policies naming it
 *                        (ADR amendment 2).
 *  --stale-seat-defaults an agent a seat still grants by default that the runtime cannot
 *                        surface and nobody owns any more.
 *
 * Dry run unless `--apply` is passed, and each class is selected separately so an operator
 * can stage them. Stale seat defaults are applied by editing `defaultAgentAssetIds` and
 * then running the seat subsystem's own reconciler, so binding revocation keeps that
 * subsystem's semantics instead of being forked here.
 *
 * Usage:
 *   node --import tsx scripts/access-control-cutover-cleanup.ts --tenant <id> \
 *     [--builtin-artifacts] [--stale-seat-defaults] [--apply] [--json]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import fs from "node:fs/promises";
import { loadConfig } from "../src/config/config.js";
import { emitAccessGovernanceAudit } from "../src/gateway/access-control/audit-sink.js";
import {
  applyBuiltinArtifactRetirement,
  applyStaleSeatAgentDefaults,
  planBuiltinArtifactRetirement,
  planStaleSeatAgentDefaults,
  type SeatAgentDefaults,
} from "../src/gateway/access-control/cutover-cleanup.js";
import {
  loadAccessPolicyStore,
  resolveAccessPolicyStorePath,
  saveAccessPolicyStore,
} from "../src/gateway/access-control/policy-store.js";
import {
  loadAgentRegistryStore,
  resolveAgentRegistryStorePath,
  saveAgentRegistryStore,
} from "../src/gateway/agent-registry/store.js";
import { resolveDefaultEnterpriseSeatAssetsStorePath } from "../src/gateway/enterprise-seat-assets-backend.js";
import { syncSeatManagedAssetBindings } from "../src/gateway/enterprise-seat-assets-governance.js";
import {
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
} from "../src/gateway/enterprise-seat-assets-store.js";
import { listOwnershipRecords } from "../src/gateway/ownership-store.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/** Timestamped copy beside the original, so a revert is a file move. */
async function backup(filePath: string, stamp: string): Promise<string | null> {
  try {
    const target = `${filePath}.pre-cutover-cleanup.${stamp}`;
    await fs.copyFile(filePath, target);
    return target;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const tenantId = readOption("--tenant")?.trim();
  const apply = readFlag("--apply");
  const asJson = readFlag("--json");
  const doBuiltin = readFlag("--builtin-artifacts");
  const doSeatDefaults = readFlag("--stale-seat-defaults");

  if (!tenantId) {
    console.error("--tenant <id> is required; this never operates on every tenant at once.");
    process.exitCode = 1;
    return;
  }
  if (!doBuiltin && !doSeatDefaults) {
    console.error("Select at least one of --builtin-artifacts or --stale-seat-defaults.");
    process.exitCode = 1;
    return;
  }

  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\..*/, "Z");
  const report: Record<string, unknown> = { tenantId, apply };

  if (doBuiltin) {
    const registry = await loadAgentRegistryStore();
    const policyStore = await loadAccessPolicyStore();
    const plan = planBuiltinArtifactRetirement({ registry, policyStore, enterpriseId: tenantId });
    const assets = plan.assetIds.map((id) => ({
      agentAssetId: id,
      agentSlug: registry.assets[id]?.agentSlug,
      legacyAgentId: registry.assets[id]?.legacyAgentId,
    }));
    report.builtinArtifacts = { plan, assets };

    if (apply && plan.assetIds.length > 0) {
      const backups = [
        await backup(resolveAgentRegistryStorePath(), stamp),
        await backup(resolveAccessPolicyStorePath(), stamp),
      ].filter(Boolean);
      const applied = applyBuiltinArtifactRetirement({ registry, policyStore, plan, nowIso });
      await saveAgentRegistryStore(registry);
      await saveAccessPolicyStore(policyStore);
      for (const agentAssetId of plan.assetIds) {
        await emitAccessGovernanceAudit({
          ts: nowIso,
          enterpriseId: tenantId,
          action: "ownership.release",
          actor: { subjectType: "platform-operator", subjectId: "access-control-cutover-cleanup" },
          target: { agentAssetId },
          detail: {
            reason: "builtin-not-an-asset",
            revokedPolicies: applied.revokedPolicies,
            closedBindings: applied.closedBindings,
          },
        });
      }
      report.builtinArtifacts = { ...(report.builtinArtifacts as object), applied, backups };
    }
  }

  if (doSeatDefaults) {
    const seatStore = await loadEnterpriseSeatAssetsStore();
    const configured = new Set(
      (loadConfig().agents?.list ?? [])
        .map((entry) => normalize(entry.id))
        .filter((entry) => entry.length > 0),
    );
    const activelyOwned = new Set(
      listOwnershipRecords()
        .filter(
          (record) =>
            record.tenantId === tenantId &&
            record.subjectKind === "agent" &&
            record.bindingStatus !== "revoked",
        )
        .map((record) => normalize(record.subjectId)),
    );
    const seats = Object.values(seatStore.seats).filter((seat) => seat.tenantId === tenantId);
    const plan = planStaleSeatAgentDefaults({
      seats: seats as SeatAgentDefaults[],
      tenantId,
      configuredAgentIds: configured,
      activelyOwnedAgentIds: activelyOwned,
    });
    report.staleSeatDefaults = {
      plan,
      configuredAgentIds: [...configured].toSorted(),
    };

    if (apply && plan.remove.length > 0) {
      const backups = [await backup(resolveDefaultEnterpriseSeatAssetsStorePath(), stamp)].filter(
        Boolean,
      );
      const changedSeatIds = applyStaleSeatAgentDefaults({
        seats: seats as SeatAgentDefaults[],
        plan,
      });
      // The seat subsystem owns binding lifecycle: reconciling against the new desired
      // state is what revokes the binding, rather than editing the binding here.
      for (const seatId of changedSeatIds) {
        const seat = seatStore.seats[seatId];
        if (seat) {
          syncSeatManagedAssetBindings({ store: seatStore, tenantId, seat, nowIso });
        }
      }
      await saveEnterpriseSeatAssetsStore(undefined, seatStore);
      for (const entry of plan.remove) {
        await emitAccessGovernanceAudit({
          ts: nowIso,
          enterpriseId: tenantId,
          action: "policy.revoke",
          actor: { subjectType: "platform-operator", subjectId: "access-control-cutover-cleanup" },
          target: { ownerType: "seat", ownerId: entry.seatId },
          detail: {
            reason: "stale-seat-default-agent",
            legacyAgentId: entry.legacyAgentId,
          },
        });
      }
      report.staleSeatDefaults = {
        ...(report.staleSeatDefaults as object),
        changedSeatIds,
        backups,
      };
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`${tenantId}: ${apply ? "APPLIED" : "DRY RUN"}`);
  const builtin = report.builtinArtifacts as
    | {
        plan: { assetIds: string[]; ownerBindingIds: string[]; policyIds: string[] };
        assets: Array<{ agentSlug?: string; legacyAgentId?: string; agentAssetId: string }>;
      }
    | undefined;
  if (builtin) {
    console.log(
      `  builtin artifacts: assets=${builtin.plan.assetIds.length} openOwnerBindings=${builtin.plan.ownerBindingIds.length} activePolicies=${builtin.plan.policyIds.length}`,
    );
    for (const asset of builtin.assets) {
      console.log(
        `    - ${asset.agentAssetId} slug=${asset.agentSlug ?? "?"} legacyAgentId=${asset.legacyAgentId ?? "-"}`,
      );
    }
  }
  const seatDefaults = report.staleSeatDefaults as
    | {
        plan: {
          remove: Array<{ seatId: string; legacyAgentId: string }>;
          review: Array<{
            seatId: string;
            legacyAgentId: string;
            missingFromConfig: boolean;
            ownershipGone: boolean;
          }>;
        };
      }
    | undefined;
  if (seatDefaults) {
    console.log(
      `  stale seat defaults: remove=${seatDefaults.plan.remove.length} review=${seatDefaults.plan.review.length}`,
    );
    for (const entry of seatDefaults.plan.remove) {
      console.log(`    - remove ${entry.legacyAgentId} from seat ${entry.seatId}`);
    }
    for (const entry of seatDefaults.plan.review) {
      const why = entry.missingFromConfig ? "not in agent list" : "ownership revoked";
      console.log(`    ? review ${entry.legacyAgentId} on seat ${entry.seatId} (${why} only)`);
    }
  }
  if (!apply) {
    console.log("  nothing was written; re-run with --apply to make these changes");
  }
}

await main();
