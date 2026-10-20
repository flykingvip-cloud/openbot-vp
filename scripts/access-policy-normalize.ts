#!/usr/bin/env node
/**
 * Source-side cleanup of v1 access policies before migrating them to V2.
 *
 * Two operator-decided actions (2026-07-31):
 *   1. revoke grants for agents that are not enterprise owned (`--revoke-agent <id>`);
 *   2. normalize `employee` subjects stored as an email address to the platform user id.
 *
 * Dry run by default. `--apply` writes the seat-assets store and appends one governance
 * audit line per mutation. Re-running after `--apply` is a no-op.
 *
 * Usage:
 *   node --import tsx scripts/access-policy-normalize.ts [--tenant <id>] \
 *     [--revoke-agent <agentId>]... [--apply] [--json]
 *
 * Task: shared-agent-identity-access-control-plane
 */

import fs from "node:fs/promises";
import path from "node:path";
import { emitAccessGovernanceAudit } from "../src/gateway/access-control/audit-sink.js";
import type { LegacyAccessPolicyV1 } from "../src/gateway/access-control/policy-v1-adapter.js";
import {
  applyV1PolicyNormalization,
  type EmailResolutionStore,
  planV1PolicyNormalization,
} from "../src/gateway/access-control/v1-normalization.js";
import {
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
} from "../src/gateway/enterprise-seat-assets-store.js";
import { CONFIG_DIR } from "../src/utils.js";

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readAllOptions(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === name) {
      const value = process.argv[index + 1];
      if (value && !value.startsWith("--")) {
        values.push(value);
      }
    }
  });
  return values;
}

/**
 * Reads the platform store directly.
 *
 * The migration entry point goes through `resolvePlatformAuthConfig`, but this cleanup
 * needs the user/membership mapping even on a host where trusted-proxy auth is not
 * configured. Only ids, emails, and memberships are read; credential fields are never
 * touched.
 */
async function loadEmailResolutionStore(): Promise<EmailResolutionStore | null> {
  const storePath = path.join(CONFIG_DIR, "openbot-platform-auth.json");
  try {
    const parsed = JSON.parse(
      await fs.readFile(storePath, "utf8"),
    ) as Partial<EmailResolutionStore>;
    return { users: parsed.users ?? {}, memberships: parsed.memberships ?? {} };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const apply = readFlag("--apply");
  const asJson = readFlag("--json");
  const tenantId = readOption("--tenant")?.trim() ?? null;
  const revokeAgentResourceIds = readAllOptions("--revoke-agent");

  const platformStore = await loadEmailResolutionStore();
  if (!platformStore) {
    console.error("Platform store not found; email subjects cannot be normalized safely.");
    process.exitCode = 1;
    return;
  }

  const seatStore = await loadEnterpriseSeatAssetsStore();
  const policies = (seatStore.accessPolicies ?? {}) as unknown as Record<
    string,
    LegacyAccessPolicyV1
  >;
  const plan = planV1PolicyNormalization({
    policies: Object.values(policies),
    platformStore,
    revokeAgentResourceIds,
    tenantId,
  });

  let applied = { revoked: [] as string[], normalized: [] as string[] };
  if (apply) {
    const nowIso = new Date().toISOString();
    applied = applyV1PolicyNormalization({ policies, plan, nowIso });
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);
    for (const policyId of applied.revoked) {
      await emitAccessGovernanceAudit({
        ts: nowIso,
        enterpriseId: policies[policyId]?.tenantId ?? tenantId ?? "unknown",
        action: "policy.revoke",
        actor: { subjectType: "platform-operator", subjectId: "cli:access-policy-normalize" },
        target: { policyId },
        detail: { reason: "agent-not-enterprise-owned" },
      });
    }
    for (const policyId of applied.normalized) {
      await emitAccessGovernanceAudit({
        ts: nowIso,
        enterpriseId: policies[policyId]?.tenantId ?? tenantId ?? "unknown",
        action: "policy.create",
        actor: { subjectType: "platform-operator", subjectId: "cli:access-policy-normalize" },
        target: { policyId },
        detail: { reason: "employee-subject-normalized-to-user-id" },
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ apply, ...plan, applied }, null, 2));
    return;
  }

  console.log(`${apply ? "Applied" : "Dry run"}: ${plan.entries.length} planned change(s)`);
  for (const action of ["revoke", "normalize-subject", "skip"] as const) {
    if (plan.counts[action] > 0) {
      console.log(`  ${action}: ${plan.counts[action]}`);
    }
  }
  for (const entry of plan.entries) {
    if (entry.action === "revoke") {
      console.log(`  - revoke ${entry.policyId} agent=${entry.resourceId}`);
    } else if (entry.action === "normalize-subject") {
      console.log(`  - subject ${entry.policyId} ${entry.fromSubjectId} -> ${entry.toSubjectId}`);
    } else {
      console.log(`  ! skip ${entry.policyId} ${entry.reason} ${entry.detail}`);
    }
  }
  if (apply) {
    console.log(`Wrote: revoked=${applied.revoked.length} normalized=${applied.normalized.length}`);
  } else {
    console.log("Nothing was written. Re-run with --apply to persist.");
  }
}

await main();
