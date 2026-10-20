#!/usr/bin/env node
/**
 * Answers the question the policy-set parity check cannot: for every real member of a
 * tenant, would switching to `enforce` change what they can actually reach?
 *
 * `scripts/access-control-parity.ts` compares the v1 and V2 *policy sets*, but the v1
 * `accessPolicies` table has no authorization consumer. The employee workbench is gated by
 * seat asset grants, seat space grants, and ownership records. So this script rebuilds each
 * member's live surface **through the same helpers the runtime uses**
 * (`buildEmployeeAccessSnapshot`, `resolveUserOwnedSubjectIds`,
 * `withEmployeeUniversalStewardAgentIds`) rather than re-deriving it, and diffs it against
 * what the V2 evaluator would grant.
 *
 * Read-only. Exits non-zero when any member's surface would change.
 *
 * Usage:
 *   node --import tsx scripts/access-control-runtime-surface.ts [--tenant <id>] [--json]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import { withEmployeeUniversalStewardAgentIds } from "../src/agents/builtin-steward/identity.js";
import { loadConfig } from "../src/config/config.js";
import {
  listTenantPolicies,
  loadAccessPolicyStore,
} from "../src/gateway/access-control/policy-store.js";
import {
  buildV2GrantedSurface,
  compareGrantedSurfaces,
  resolveRuntimeAgentSurface,
  type GrantedSurfaceComparison,
} from "../src/gateway/access-control/runtime-shadow.js";
import { loadAgentRegistryStore } from "../src/gateway/agent-registry/store.js";
import {
  buildEmployeeAccessSnapshot,
  loadEnterpriseSeatAssetsStore,
} from "../src/gateway/enterprise-seat-assets-store.js";
import { listOwnershipRecords } from "../src/gateway/ownership-store.js";
import { resolvePlatformAuthConfig } from "../src/gateway/platform-auth/config.js";
import { loadStore } from "../src/gateway/platform-auth/store.js";

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

type MemberReport = {
  membershipId: string;
  userId: string;
  seatId: string | null;
  runtimeAgents: number;
  runtimeSpaces: number;
  comparison: GrantedSurfaceComparison;
};

/**
 * Loaded lazily so an unrelated compile break in the shared tree produces an actionable
 * message instead of a module-resolution stack trace. Re-deriving the ownership rule here
 * instead is not an option: measuring the real gate is the entire point of this script.
 */
async function loadOwnedSubjectResolver(): Promise<
  typeof import("../src/gateway/employee-workbench-scope.js").resolveUserOwnedSubjectIds
> {
  const module = await import("../src/gateway/employee-workbench-scope.js");
  return module.resolveUserOwnedSubjectIds;
}

async function main(): Promise<void> {
  const tenantFilter = readOption("--tenant")?.trim();
  const asJson = readFlag("--json");

  let resolveUserOwnedSubjectIds: Awaited<ReturnType<typeof loadOwnedSubjectResolver>>;
  try {
    resolveUserOwnedSubjectIds = await loadOwnedSubjectResolver();
  } catch (error) {
    console.error(
      "Cannot load src/gateway/employee-workbench-scope.ts, which owns the live workbench" +
        " gate this script measures. Resolve that module first.",
    );
    console.error(`  ${String(error)}`);
    process.exitCode = 1;
    return;
  }

  const platformConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!platformConfig) {
    console.error(
      "Platform auth is not configured on this host, so no membership can be resolved.",
    );
    process.exitCode = 1;
    return;
  }
  const platformStore = await loadStore(platformConfig);
  const seatStore = await loadEnterpriseSeatAssetsStore();
  const registry = await loadAgentRegistryStore();
  const policyStore = await loadAccessPolicyStore();
  const ownershipRecords = listOwnershipRecords();

  const memberships = Object.values(platformStore.memberships).filter(
    (membership) => !tenantFilter || membership.enterpriseId === tenantFilter,
  );
  const tenantIds = [...new Set(memberships.map((entry) => entry.enterpriseId))].toSorted();

  const byTenant = new Map<string, MemberReport[]>();
  for (const enterpriseId of tenantIds) {
    const policies = listTenantPolicies(policyStore, enterpriseId);
    const reports: MemberReport[] = [];

    for (const membership of memberships.filter((entry) => entry.enterpriseId === enterpriseId)) {
      const user = platformStore.users[membership.userId];
      if (!user) {
        continue;
      }
      // Exactly the surface `resolveEmployeeWorkbenchActor` would hand this user.
      const access = buildEmployeeAccessSnapshot({
        store: seatStore,
        tenantId: enterpriseId,
        employeeId: user.id,
      });
      const identities = new Set([normalize(user.id), normalize(user.email)].filter(Boolean));
      const owned = resolveUserOwnedSubjectIds({
        records: ownershipRecords,
        tenantId: enterpriseId,
        identities,
      });
      const legacyAgentIds = withEmployeeUniversalStewardAgentIds([
        ...owned.agentIds,
        ...access.agentIds,
      ]);
      const spaceIds = [...new Set([...owned.groupIds, ...access.defaultSpaceIds])];
      const seatId = access.currentSeat?.seatId ?? null;

      const subjects = [
        { subjectType: "membership", subjectId: membership.id, status: "active" } as const,
        ...(seatId ? [{ subjectType: "seat", subjectId: seatId, status: "active" } as const] : []),
      ];
      const runtime = resolveRuntimeAgentSurface({ registry, enterpriseId, legacyAgentIds });
      const v2 = buildV2GrantedSurface({ policies, registry, enterpriseId, subjects });
      reports.push({
        membershipId: membership.id,
        userId: user.id,
        seatId,
        runtimeAgents: legacyAgentIds.length,
        runtimeSpaces: spaceIds.length,
        comparison: compareGrantedSurfaces({ runtime, runtimeSpaceIds: spaceIds, v2 }),
      });
    }
    byTenant.set(enterpriseId, reports);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { tenants: [...byTenant].map(([enterpriseId, members]) => ({ enterpriseId, members })) },
        null,
        2,
      ),
    );
    return;
  }

  let changed = 0;
  for (const [enterpriseId, members] of byTenant) {
    const diverging = members.filter((member) => !member.comparison.equivalent);
    changed += diverging.length;
    const verdict = diverging.length === 0 ? "UNCHANGED" : "WOULD CHANGE";
    console.log(
      `${enterpriseId}: ${verdict} members=${members.length} equivalent=${members.length - diverging.length} changed=${diverging.length}`,
    );
    for (const member of diverging) {
      const { agent, space, unresolvedLegacyAgentIds, universalBuiltinOnlyInRuntime } =
        member.comparison;
      const parts = [
        `agents -${agent.onlyInRuntime.length}/+${agent.onlyInV2.length}`,
        `spaces -${space.onlyInRuntime.length}/+${space.onlyInV2.length}`,
      ];
      if (unresolvedLegacyAgentIds.length > 0) {
        parts.push(`unnameable=${unresolvedLegacyAgentIds.length}`);
      }
      if (universalBuiltinOnlyInRuntime.length > 0) {
        parts.push("includes-universal-steward");
      }
      console.log(
        `  ! membership=${member.membershipId} seat=${member.seatId ?? "none"} ${parts.join(" ")}`,
      );
      if (agent.onlyInRuntime.length > 0) {
        console.log(`      would lose agents: ${agent.onlyInRuntime.join(", ")}`);
      }
      if (agent.onlyInV2.length > 0) {
        console.log(`      would gain agents: ${agent.onlyInV2.join(", ")}`);
      }
      if (space.onlyInRuntime.length > 0) {
        console.log(`      would lose spaces: ${space.onlyInRuntime.join(", ")}`);
      }
      if (space.onlyInV2.length > 0) {
        console.log(`      would gain spaces: ${space.onlyInV2.join(", ")}`);
      }
      if (unresolvedLegacyAgentIds.length > 0) {
        console.log(`      not nameable in V2: ${unresolvedLegacyAgentIds.join(", ")}`);
      }
    }
  }

  if (changed > 0) {
    // Non-zero so this can gate an enforcement cutover.
    process.exitCode = 1;
  }
}

await main();
