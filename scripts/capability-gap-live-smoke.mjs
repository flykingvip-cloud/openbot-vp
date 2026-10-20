#!/usr/bin/env node
/**
 * Read-only live-config smoke: copy a *narrow* subset of ~/.openbot into a temp
 * dir (openbot.json + evolution-control + delegation snapshot if present), run
 * bootstrap grant + one consumer tick there, show SUGGESTED. Never writes the
 * real ~/.openbot tree. Avoids copying multi-GB agent/media trees.
 *
 * Usage: node scripts/capability-gap-live-smoke.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const realHome = path.join(os.homedir(), ".openbot");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cap-gap-smoke-"));
const copiedState = path.join(tmpRoot, "state");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function copyIfExists(rel) {
  const src = path.join(realHome, rel);
  const dest = path.join(copiedState, rel);
  if (!fs.existsSync(src)) {
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, dereference: true });
  } else {
    fs.copyFileSync(src, dest);
  }
  return true;
}

if (!fs.existsSync(realHome)) {
  log(`SKIP: ${realHome} does not exist`);
  process.exit(0);
}

fs.mkdirSync(copiedState, { recursive: true });
const copied = [];
for (const rel of [
  "openbot.json",
  "evolution-control",
  "evolution-governance",
  "delegation-grants.snapshot.json",
]) {
  if (copyIfExists(rel)) {
    copied.push(rel);
  }
}
log(`Copied subset of ${realHome} → ${copiedState}: ${copied.join(", ") || "(none)"}`);
process.env.OPENBOT_STATE_DIR = copiedState;

const tsxRunner = path.join(tmpRoot, "smoke-tsx.mts");
fs.writeFileSync(
  tsxRunner,
  `
import fs from "node:fs";
import path from "node:path";

const { resetSharedDiagnosisDelegationForTests, getSharedDiagnosisDelegationMachine } = await import(
  ${JSON.stringify(path.join(repoRoot, "src/gateway/evolution-control/delegation-service.ts"))}
);
const { ensureCapabilityGapSystemGrant } = await import(
  ${JSON.stringify(path.join(repoRoot, "src/gateway/evolution-control/capability-gap-grant.ts"))}
);
const { createGatewayEvolutionControlPlane } = await import(
  ${JSON.stringify(path.join(repoRoot, "src/gateway/evolution-control/gateway-plane.ts"))}
);
const { recordCapabilityGapEvent, resetCapabilityGapDedupForTests } = await import(
  ${JSON.stringify(path.join(repoRoot, "src/gateway/evolution-control/capability-gap-ingest.ts"))}
);
const {
  configureCapabilityGapConsumer,
  runCapabilityGapConsumerTick,
  resetCapabilityGapConsumerConfigForTests,
} = await import(
  ${JSON.stringify(path.join(repoRoot, "src/gateway/evolution-control/capability-gap-consumer.ts"))}
);

const stateDir = process.env.OPENBOT_STATE_DIR!;
const persistDir = path.join(stateDir, "evolution-control-smoke");
fs.mkdirSync(persistDir, { recursive: true });

resetSharedDiagnosisDelegationForTests();
resetCapabilityGapDedupForTests();
resetCapabilityGapConsumerConfigForTests();

const TENANT = "smoke-tenant-readonly";
const machine = getSharedDiagnosisDelegationMachine(persistDir);
const grant = ensureCapabilityGapSystemGrant({ machine, tenantId: TENANT });
const plane = createGatewayEvolutionControlPlane({
  persistDir,
  cfg: { agents: { list: [] } } as never,
});

configureCapabilityGapConsumer({ explicitMarkerThreshold: 1 });
const recorded = recordCapabilityGapEvent({
  plane,
  persistDir,
  runId: "smoke-run-1",
  agentId: "smoke-bot",
  tenantId: TENANT,
  sessionKey: "agent:smoke-bot:main",
  category: "skill",
  reason: "smoke_marker_gap",
  detail: "smoke_marker_gap",
  explicitMarker: true,
  sourceKind: "marker",
  ownerUserId: "smoke-owner",
  dedupWindowMs: 0,
});

const tick = runCapabilityGapConsumerTick({ plane, persistDir });
const proposal = plane.getProposal(recorded.proposalId!);

const report = {
  stamp: ${JSON.stringify(stamp)},
  realHome: ${JSON.stringify(realHome)},
  copiedState: stateDir,
  copiedSubset: ${JSON.stringify(copied)},
  realHomeUntouched: true,
  grantId: grant.grantId,
  grantStatus: grant.grant.status,
  allowedActions: grant.grant.allowedActions,
  recordedStatus: recorded.proposal?.status ?? null,
  evidenceRefs: recorded.proposal?.sourceEvidenceRefs ?? [],
  tick,
  afterTickStatus: proposal?.status ?? null,
  suggested: proposal?.status === "SUGGESTED",
};
console.log(JSON.stringify(report, null, 2));
if (proposal?.status !== "SUGGESTED") {
  process.exitCode = 2;
}
`,
);

log(`Running smoke against copy (OPENBOT_STATE_DIR=${copiedState})`);
const result = spawnSync("pnpm", ["exec", "tsx", tsxRunner], {
  cwd: repoRoot,
  env: { ...process.env, OPENBOT_STATE_DIR: copiedState },
  encoding: "utf8",
  timeout: 120_000,
});
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.status !== 0) {
  log(`smoke failed status=${result.status}`);
  process.exit(result.status ?? 1);
}
log(`OK — real home untouched; smoke artifacts under ${tmpRoot}`);
