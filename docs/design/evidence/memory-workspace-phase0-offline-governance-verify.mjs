/**
 * Offline Phase 0 governance verification — no gh, no network, no local auth.
 * Use when the authorization layer returns 503 and official-review cannot re-run gh.
 */
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = path.join(import.meta.dirname);

export const PATHS = {
  packR25: path.join(EVIDENCE_DIR, "memory-workspace-phase0-offline-gh-evidence-pack-r25.json"),
  runnerStabilityR25: path.join(EVIDENCE_DIR, "memory-workspace-phase0-runner-stability-r25.json"),
  legacyPack: path.join(EVIDENCE_DIR, "memory-workspace-phase0-offline-gh-evidence-pack.json"),
};

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function requiredContextsFromRuleset(rulesetParsed) {
  const required = rulesetParsed.rules.find((r) => r.type === "required_status_checks");
  if (!required) {
    throw new Error("ruleset missing required_status_checks");
  }
  return required.parameters.required_status_checks.map((c) => c.context);
}

const PR409_MERGE = "d261378ff3d283d134a6ed4088e836842380294d";
const PR401_MERGE = "1ab9d33e69ea3803e5d4e0f0be7ece83653fb792";

export function verifyGhEvidencePack(pack, { expectReviewSequence = 25 } = {}) {
  const errors = [];
  const byId = new Map((pack.commands ?? []).map((c) => [c.id, c]));

  if (pack.schema !== "memory-workspace-phase0-offline-gh-evidence-pack/v1") {
    errors.push(`unexpected schema: ${pack.schema}`);
  }
  if (pack.reviewSequence !== expectReviewSequence) {
    errors.push(`reviewSequence=${pack.reviewSequence}, expected ${expectReviewSequence}`);
  }
  if (!pack.mainSha || !/^[0-9a-f]{40}$/.test(pack.mainSha)) {
    errors.push(`invalid mainSha: ${pack.mainSha}`);
  }
  if (pack.governance?.phase0Accepted !== false) {
    errors.push("governance.phase0Accepted must remain false until official-review signs");
  }
  if (pack.governance?.deployAuthorized !== false) {
    errors.push("governance.deployAuthorized must remain false");
  }
  if (pack.governance?.closesWsC !== false) {
    errors.push("governance.closesWsC must remain false");
  }

  const requiredIds = [
    "main-commit",
    "pr409-view",
    "pr401-view",
    "ruleset-19808307",
    "actions-runners",
  ];
  for (const id of requiredIds) {
    if (!byId.has(id)) {
      errors.push(`missing command capture: ${id}`);
    }
  }

  const mainCommit = byId.get("main-commit");
  if (mainCommit?.parsed?.sha && mainCommit.parsed.sha !== pack.mainSha) {
    errors.push(`main-commit sha ${mainCommit.parsed.sha} != pack.mainSha ${pack.mainSha}`);
  }

  const pr409 = byId.get("pr409-view");
  if (pr409?.parsed?.state !== "MERGED") {
    errors.push(`pr409 state=${pr409?.parsed?.state}, expected MERGED`);
  }
  if (pr409?.parsed?.reviewDecision !== "APPROVED") {
    errors.push(`pr409 reviewDecision=${pr409?.parsed?.reviewDecision}, expected APPROVED`);
  }
  if (pr409?.parsed?.mergeCommit?.oid !== PR409_MERGE) {
    errors.push("pr409 mergeCommit oid mismatch (#409 anchor)");
  }

  const pr401 = byId.get("pr401-view");
  if (pr401?.parsed?.state !== "MERGED") {
    errors.push(`pr401 state=${pr401?.parsed?.state}, expected MERGED`);
  }
  if (pr401?.parsed?.reviewDecision !== "APPROVED") {
    errors.push(`pr401 reviewDecision=${pr401?.parsed?.reviewDecision}, expected APPROVED`);
  }
  if (pr401?.parsed?.mergeCommit?.oid !== PR401_MERGE) {
    errors.push("pr401 mergeCommit oid mismatch (#401 anchor)");
  }

  const pr414 = byId.get("pr414-view");
  if (pr414) {
    if (pr414.parsed?.state !== "MERGED") {
      errors.push(`pr414 state=${pr414?.parsed?.state}, expected MERGED`);
    }
    if (pr414.parsed?.reviewDecision !== "APPROVED") {
      errors.push(`pr414 reviewDecision=${pr414?.parsed?.reviewDecision}, expected APPROVED`);
    }
  }

  const ruleset = byId.get("ruleset-19808307");
  try {
    const contexts = requiredContextsFromRuleset(ruleset.parsed);
    const expected = [
      "delivery guard",
      "check (types, lint, format)",
      "freeze + phase0 evidence tests",
    ];
    if (JSON.stringify(contexts) !== JSON.stringify(expected)) {
      errors.push(`ruleset contexts=${JSON.stringify(contexts)}`);
    }
    if (ruleset.parsed.enforcement && ruleset.parsed.enforcement !== "active") {
      errors.push(`ruleset enforcement=${ruleset.parsed.enforcement}`);
    }
  } catch (err) {
    errors.push(String(err));
  }

  const runners = byId.get("actions-runners");
  if ((runners?.parsed?.total_count ?? 0) < 1) {
    errors.push("actions-runners total_count < 1");
  }

  const ciGate =
    byId.get("main-ci-gate-latest") ??
    byId.get("main-ci-gate-push") ??
    byId.get("main-ci-gate-dispatch-post-restart");
  if (ciGate?.parsed?.conclusion && ciGate.parsed.conclusion !== "success") {
    errors.push(`main ci-gate conclusion=${ciGate.parsed.conclusion}`);
  }

  const freeze =
    byId.get("main-freeze-latest") ??
    byId.get("main-freeze-push") ??
    byId.get("main-freeze-dispatch-post-restart");
  if (freeze?.parsed?.conclusion && freeze.parsed.conclusion !== "success") {
    errors.push(`main freeze conclusion=${freeze.parsed.conclusion}`);
  }

  return { ok: errors.length === 0, errors };
}

/** @deprecated alias kept for r25 test imports */
export const verifyGhEvidencePackR25 = (pack) =>
  verifyGhEvidencePack(pack, { expectReviewSequence: 25 });

export function verifyRunnerStability(stability) {
  const errors = [];
  if (stability.schema !== "memory-workspace-phase0-runner-stability/v1") {
    errors.push(`unexpected runner stability schema: ${stability.schema}`);
  }
  if (stability.meetsMinimumBar !== true) {
    errors.push("runner stability meetsMinimumBar !== true");
  }
  if ((stability.consecutiveSuccessCount ?? 0) < 3) {
    errors.push("runner stability consecutiveSuccessCount < 3");
  }
  if ((stability.cycles?.length ?? 0) < 3) {
    errors.push("runner stability cycles.length < 3");
  }
  for (const cycle of stability.cycles ?? []) {
    if (cycle.allRequiredSuccess !== true) {
      errors.push(`cycle ${cycle.label ?? cycle.id ?? "?"} allRequiredSuccess !== true`);
    }
    for (const check of cycle.checks ?? []) {
      if (check.conclusion !== "success") {
        errors.push(`check ${check.name ?? check.context} conclusion=${check.conclusion}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function verifyOfflineGovernance({ expectReviewSequence = 25 } = {}) {
  const pack = loadJson(PATHS.packR25);
  const packResult = verifyGhEvidencePack(pack, { expectReviewSequence });
  const stability = loadJson(PATHS.runnerStabilityR25);
  const stabilityResult = verifyRunnerStability(stability);

  const errors = [...packResult.errors, ...stabilityResult.errors];
  return {
    ok: errors.length === 0,
    errors,
    mainSha: pack.mainSha,
    capturedAt: pack.capturedAt,
    captureProvenance: pack.captureProvenance,
    githubRunUrl: pack.githubRunUrl,
  };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const result = verifyOfflineGovernance();
  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          verdict: "PASS",
          mainSha: result.mainSha,
          capturedAt: result.capturedAt,
          captureProvenance: result.captureProvenance,
          githubRunUrl: result.githubRunUrl,
          note: "503-bypass: no local gh required",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.error(JSON.stringify({ verdict: "FAIL", errors: result.errors }, null, 2));
  process.exit(1);
}
