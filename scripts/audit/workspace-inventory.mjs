#!/usr/bin/env node
/**
 * Read-only workspace inventory CLI (P0-a).
 * stdout-only by default. Supports --mode redacted|raw.
 *
 * Usage:
 *   OPENBOT_STATE_DIR=/path/to/state \
 *   SAMPLE_TENANT=t1 SAMPLE_USER=u1 \
 *   node scripts/audit/workspace-inventory.mjs --mode redacted
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function die(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function requireSafeSegment(name) {
  const value = process.env[name]?.trim();
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    die(`${name} must be one safe path segment`);
  }
  return value;
}

function resolveContained(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    die(`path escapes containment root: ${candidate}`);
  }
  return resolved;
}

function parseArgs(argv) {
  let mode = "redacted";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("workspace-inventory.mjs --mode redacted|raw");
      process.exit(0);
    }
    die(`unknown argument: ${arg}`);
  }
  if (mode !== "redacted" && mode !== "raw") {
    die("--mode must be redacted or raw");
  }
  return { mode };
}

function collectCandidates(stateDir, tenant, user) {
  const tenantsRoot = path.join(stateDir, "tenants");
  const candidates = [];
  const pushIfExists = (record) => {
    if (fs.existsSync(record.absoluteRoot)) {
      candidates.push(record);
    }
  };

  pushIfExists({
    candidateId: "employee_steward",
    absoluteRoot: path.join(stateDir, "agents", "main", "employees", user, "workspace"),
    normalizedRootClass: "employee_steward_workspace",
    tenantRef: tenant,
    ownerRef: user,
    ownershipStatus: "unknown",
    bindingRole: "writer",
  });
  pushIfExists({
    candidateId: "user_flat_workspace",
    absoluteRoot: path.join(tenantsRoot, tenant, "users", user, "OpenBot", "workspace"),
    normalizedRootClass: "user_flat_workspace",
    tenantRef: tenant,
    ownerRef: user,
    ownershipStatus: "unknown",
    bindingRole: "writer",
  });

  const agentAssetsRoot = path.join(tenantsRoot, tenant, "agent-assets");
  if (fs.existsSync(agentAssetsRoot)) {
    for (const entry of fs.readdirSync(agentAssetsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      pushIfExists({
        candidateId: `agent_asset:${entry.name}`,
        absoluteRoot: path.join(agentAssetsRoot, entry.name),
        normalizedRootClass: "agent_asset_workspace",
        tenantRef: tenant,
        agentAssetId: entry.name,
        ownershipStatus: "unknown",
        bindingRole: "unknown",
      });
    }
  }

  const groupsRoot = path.join(tenantsRoot, tenant, "collaboration", "groups");
  if (fs.existsSync(groupsRoot)) {
    for (const entry of fs.readdirSync(groupsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      pushIfExists({
        candidateId: `group:${entry.name}`,
        absoluteRoot: path.join(groupsRoot, entry.name),
        normalizedRootClass: "collaboration_group",
        tenantRef: tenant,
        groupId: entry.name,
        ownershipStatus: "unknown",
        bindingRole: "unknown",
      });
    }
  }

  // Risk candidates only — never writers.
  pushIfExists({
    candidateId: "canvas_host",
    absoluteRoot: path.join(stateDir, "canvas"),
    normalizedRootClass: "canvas_host",
    ownershipStatus: "unknown",
    bindingRole: "risk_candidate",
  });
  pushIfExists({
    candidateId: "host_skills",
    absoluteRoot: path.join(stateDir, "skills"),
    normalizedRootClass: "host_skills",
    ownershipStatus: "unknown",
    bindingRole: "risk_candidate",
  });

  return candidates.map((candidate) => ({
    ...candidate,
    absoluteRoot: resolveContained(stateDir, candidate.absoluteRoot),
  }));
}

async function main() {
  const { mode } = parseArgs(process.argv);
  const stateDir = path.resolve(process.env.OPENBOT_STATE_DIR?.trim() || "");
  if (!stateDir) {
    die("missing required env: OPENBOT_STATE_DIR");
  }
  const tenant = requireSafeSegment("SAMPLE_TENANT");
  const user = requireSafeSegment("SAMPLE_USER");

  // Load compiled/testable inventory helpers via dynamic TS import when available.
  const inventoryUrl = pathToFileURL(path.resolve("src/gateway/workspace/inventory.ts")).href;
  const {
    inventoryCandidate,
    deriveInventorySummary,
    listUnknownOwnershipQuarantine,
    redactInventoryRecord,
  } = await import(inventoryUrl);

  const candidates = collectCandidates(stateDir, tenant, user);
  const records = candidates.map((candidate) => inventoryCandidate(candidate, stateDir));
  const outputRecords = mode === "redacted" ? records.map(redactInventoryRecord) : records;
  const summary = deriveInventorySummary(outputRecords);
  const quarantine = listUnknownOwnershipQuarantine(outputRecords);

  process.stdout.write(
    `${JSON.stringify(
      {
        schema: "workspace-inventory/v1",
        mode,
        summary,
        quarantineCandidateIds: quarantine.map((r) => r.candidateId),
        records: outputRecords,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err), 1);
});
