#!/usr/bin/env node
/**
 * Answers one question before any tenant is switched to enforcement: would the V2
 * evaluator decide exactly what v1 decides today?
 *
 * For every v1 access policy row it restates the grant as a V2 question and compares the
 * verdicts. Rows are collapsed into one question per distinct (subject, resource, action),
 * because v1 allows whenever *any* active row grants it: a revoked row alongside a live
 * re-grant is still allowed today. Any divergence is what would change at the moment
 * enforcement is enabled.
 *
 * A grant that cannot be restated in V2 at all is reported separately, and only blocks when
 * it would actually cost someone access: a revoked row grants nothing today, and a universal
 * builtin is excluded by model decision while the runtime still grants it to every employee.
 * Anything else that is active would be silently dropped by enforcement, so it blocks.
 *
 * Read-only. It writes nothing except optional decision audit lines with `--audit`.
 *
 * Usage:
 *   node --import tsx scripts/access-control-parity.ts [--tenant <id>] [--json] [--audit]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import fs from "node:fs/promises";
import path from "node:path";
import { authorizeAgentAssetAccess } from "../src/gateway/access-control/authorize.js";
import {
  checkAccessParity,
  resolveParityExpectations,
  type ParityGrantRow,
} from "../src/gateway/access-control/parity.js";
import {
  loadAccessPolicyStore,
  listTenantPolicies,
} from "../src/gateway/access-control/policy-store.js";
import type { LegacyAccessPolicyV1 } from "../src/gateway/access-control/policy-v1-adapter.js";
import {
  type AccessPermission,
  type AccessResourceType,
  type AccessSubject,
  isAccessPermission,
} from "../src/gateway/access-control/policy-v2-types.js";
import { resolveLegacyAgentId } from "../src/gateway/agent-registry/legacy-resolver.js";
import { loadAgentRegistryStore } from "../src/gateway/agent-registry/store.js";
import { loadEnterpriseSeatAssetsStore } from "../src/gateway/enterprise-seat-assets-store.js";
import { CONFIG_DIR } from "../src/utils.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Same mapping the migration uses, so parity asks the migrated question. */
const RESOURCE_TYPE_TO_V2: Record<string, AccessResourceType> = {
  agent: "agent_asset",
  seat: "seat",
  space: "space",
  memory: "memory",
  capability: "capability",
};

function permissionFor(resourceType: string, action: string): AccessPermission | null {
  const candidate = resourceType === "agent" ? `agent.${action}` : `${resourceType}.${action}`;
  return isAccessPermission(candidate) ? candidate : null;
}

type PlatformStore = {
  users: Record<string, { id: string; normalizedEmail?: string; status?: string }>;
  memberships: Record<string, { id: string; userId: string; enterpriseId: string }>;
};

async function loadPlatformStore(): Promise<PlatformStore> {
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, "openbot-platform-auth.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<PlatformStore>;
    return { users: parsed.users ?? {}, memberships: parsed.memberships ?? {} };
  } catch {
    return { users: {}, memberships: {} };
  }
}

function membershipIdFor(
  store: PlatformStore,
  enterpriseId: string,
  userId: string,
): string | null {
  const matches = Object.values(store.memberships).filter(
    (membership) => membership.userId === userId && membership.enterpriseId === enterpriseId,
  );
  return matches.length === 1 ? matches[0].id : null;
}

async function main(): Promise<void> {
  const tenantFilter = readOption("--tenant")?.trim();
  const asJson = readFlag("--json");
  const withAudit = readFlag("--audit");

  const seatStore = await loadEnterpriseSeatAssetsStore();
  const registry = await loadAgentRegistryStore();
  const policyStore = await loadAccessPolicyStore();
  const platformStore = await loadPlatformStore();

  const rows = (Object.values(seatStore.accessPolicies ?? {}) as LegacyAccessPolicyV1[]).filter(
    (row) => !tenantFilter || row.tenantId === tenantFilter,
  );
  const tenantIds = [...new Set(rows.map((row) => row.tenantId))].toSorted();

  /**
   * `blocking` is not simply `active`: a universal builtin is excluded by model decision,
   * not by a gap, and the runtime grants it to every employee regardless of policy. So an
   * active builtin row loses nothing at cutover, while any other active unrepresentable
   * grant does.
   */
  type NotComparable = { reason: string; active: boolean; blocking: boolean; detail: string };
  const results: Array<{
    enterpriseId: string;
    report: ReturnType<typeof checkAccessParity>;
    notComparable: NotComparable[];
  }> = [];
  for (const enterpriseId of tenantIds) {
    const grantRows: ParityGrantRow[] = [];
    const notComparable: NotComparable[] = [];

    for (const row of rows.filter((entry) => entry.tenantId === enterpriseId)) {
      const active = !row.revokedAt;
      const resourceType = RESOURCE_TYPE_TO_V2[row.resourceType];
      const permission = permissionFor(row.resourceType, row.action);
      if (!resourceType || !permission) {
        // Not represented in V2 at all, so there is nothing to compare.
        notComparable.push({
          reason: "resource-not-in-v2",
          active,
          blocking: active,
          detail: `${row.policyId} ${row.resourceType}.${row.action}`,
        });
        continue;
      }

      let resourceId = row.resourceId;
      if (row.resourceType === "agent") {
        const resolution = resolveLegacyAgentId({
          store: registry,
          enterpriseId,
          legacyAgentId: row.resourceId,
        });
        if (resolution.kind === "builtin-universal") {
          notComparable.push({
            reason: "builtin-not-an-asset",
            active,
            blocking: false,
            detail: `${row.policyId} legacyAgentId=${row.resourceId}`,
          });
          continue;
        }
        if (resolution.kind !== "resolved") {
          notComparable.push({
            reason: `agent-${resolution.kind}`,
            active,
            blocking: active,
            detail: `${row.policyId} legacyAgentId=${row.resourceId}`,
          });
          continue;
        }
        resourceId = resolution.ref.agentAssetId;
      }

      let subject: AccessSubject;
      if (row.subjectType === "seat") {
        subject = { subjectType: "seat", subjectId: row.subjectId, status: "active" };
      } else {
        const membershipId = membershipIdFor(platformStore, enterpriseId, row.subjectId);
        if (!membershipId) {
          notComparable.push({
            reason: "membership-not-unique",
            active,
            blocking: active,
            detail: `${row.policyId} subject=${row.subjectType}:${row.subjectId}`,
          });
          continue;
        }
        subject = { subjectType: "membership", subjectId: membershipId, status: "active" };
      }

      grantRows.push({
        sourcePolicyId: row.policyId,
        subject,
        resource: { enterpriseId, resourceType, resourceId },
        permission,
        revoked: Boolean(row.revokedAt),
      });
    }

    // One question per distinct grant: v1 allows when any active row grants it.
    const expectations = resolveParityExpectations(grantRows);

    const report = checkAccessParity({
      expectations,
      policies: listTenantPolicies(policyStore, enterpriseId),
      registry,
    });
    results.push({ enterpriseId, report, notComparable });

    if (withAudit) {
      // Record the same decisions in the audit stream, in shadow mode, so the evidence
      // also exists where an operator reviews authorization history.
      for (const expectation of expectations) {
        await authorizeAgentAssetAccess({
          policies: listTenantPolicies(policyStore, enterpriseId),
          registry,
          subject: expectation.subject,
          resource: expectation.resource,
          permission: expectation.permission,
          mode: "shadow",
          requestId: `parity:${expectation.sourcePolicyId}`,
        });
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ tenants: results }, null, 2));
    return;
  }

  let blocking = 0;
  for (const { enterpriseId, report, notComparable } of results) {
    const gaps = notComparable.filter((entry) => entry.blocking);
    const ok = report.divergences.length === 0 && gaps.length === 0;
    if (!ok) {
      blocking += 1;
    }
    const verdict = ok ? "PARITY" : "DIVERGENT";
    console.log(
      `${enterpriseId}: ${verdict} checked=${report.checked} agreed=${report.agreed} divergent=${report.divergences.length} notComparable=${notComparable.length} (blocking=${gaps.length})`,
    );
    for (const entry of notComparable) {
      const marker = entry.blocking ? "! GAP    " : entry.active ? "- byModel" : "- revoked";
      console.log(`  ${marker} not-comparable ${entry.reason}: ${entry.detail}`);
    }
    for (const [reason, count] of Object.entries(report.reasonCounts)) {
      console.log(`  reason ${reason}: ${count}`);
    }
    for (const divergence of report.divergences.slice(0, 20)) {
      console.log(
        `  ! ${divergence.sourcePolicyId} ${divergence.permission} on ${divergence.resourceType}/${divergence.resourceId} expected=${divergence.expected} actual=${divergence.actual} ${divergence.reason ?? ""}`,
      );
    }
    if (report.divergences.length > 20) {
      console.log(`  … ${report.divergences.length - 20} more`);
    }
  }

  if (blocking > 0) {
    // Non-zero exit so this can gate an enforcement cutover.
    process.exitCode = 1;
  }
}

await main();
