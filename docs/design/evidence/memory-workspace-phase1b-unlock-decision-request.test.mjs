import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const TIP = "85f55ee2fa76f88dc538180b481a5823631af649";

function loadEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Disk(relPath) {
  return sha256Bytes(fs.readFileSync(path.join(REPO, relPath)));
}

function sha256Git(rev, relPath) {
  return sha256Bytes(
    execFileSync("git", ["show", `${rev}:${relPath}`], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
}

void test("phase 1b unlock decision request is preparation only and binds SHAs", () => {
  const request = loadEvidence("memory-workspace-phase1b-unlock-decision-request.json");
  const receipt = loadEvidence("memory-workspace-phase1b-unlock-decision.json");
  const met = loadEvidence("memory-workspace-phase1b-item5-met-decision.json");
  const binding = loadEvidence("memory-workspace-phase1b-item5-final-closeout-binding.json");
  const equivalent = loadEvidence("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const handoff = fs.readFileSync(
    path.join(
      REPO,
      ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-unlock-decision.md",
    ),
    "utf8",
  );
  const closeoutHandoff = fs.readFileSync(
    path.join(
      REPO,
      ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md",
    ),
    "utf8",
  );

  assert.equal(request.kind, "unlock-decision-preparation");
  assert.equal(request.unlock, "not-issued");
  assert.equal(request.signedBy, null);
  assert.equal(request.issuedAt, null);
  assert.equal(request.phase1bExecutionBlocked, true);
  assert.equal(request.deployAuthorized, false);
  assert.equal(request.wiredToProductionResolver, false);
  assert.equal(request.cutoverLive, false);
  assert.equal(request.recommendUnlock, "issue-minimal");
  assert.equal(request.items["5"], "met");
  assert.equal(request.items["6"], "not-met");
  assert.equal(request.items["7"], "not-met");
  assert.equal(request.item6Unlocked, false);
  assert.equal(request.item7Unlocked, false);
  assert.equal(request.reviewTip, TIP);
  assert.equal(request.reviewSurface, "https://github.com/gmood2008/openbot/pull/538");
  assert.ok(request.doesNotAuthorize.includes("treat this request as an issued unlock receipt"));
  assert.ok(
    request.item5MetCitations.notFinalItem5Proof.includes(
      ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-runtime-alignment-20260819.md",
    ),
  );
  assert.ok(request.item5MetCitations.notFinalItem5Proof.some((line) => line.includes("I4")));
  assert.equal(request.currentStatus.item6.locked, true);
  assert.ok(
    request.currentStatus.item6.blockers.some((line) => line.includes("item6Candidate=met")),
  );

  assert.equal(receipt.unlock, "not-issued");
  assert.equal(receipt.phase1bExecutionBlocked, true);
  assert.equal(receipt.deployAuthorized, false);
  assert.notEqual(receipt.unlock, "issued");

  assert.equal(met.item5Met, true);
  assert.equal(met.item5, "met");
  assert.equal(met.unlock, "not-issued");
  assert.equal(met.item6Unlocked, false);
  assert.equal(met.item7Unlocked, false);
  assert.equal(met.wiredToProductionResolver, false);
  assert.equal(met.reviewTip, TIP);
  assert.equal(
    met.closeoutBinding,
    "docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json",
  );
  assert.equal(binding.item5Met, false);
  assert.equal(binding.unlock, "not-issued");
  assert.equal(equivalent.item6Candidate, "met");
  assert.equal(equivalent.item6Unlocked, false);

  assert.match(handoff, /Phase 1B Unlock Decision Review only/);
  assert.match(handoff, /not-issued/);
  assert.doesNotMatch(handoff, /unlock=issued/);
  assert.match(handoff, /Not Item 5 final proof/);
  assert.match(closeoutHandoff, /Item 5 Final Closeout Review/);

  for (const [relPath, expected] of Object.entries(request.references)) {
    const found = new Set();
    const disk = path.join(REPO, relPath);
    if (fs.existsSync(disk)) {
      found.add(sha256Disk(relPath));
    }
    for (const rev of [TIP, "origin/cursor-data-governance/item5-final-closeout", "origin/main"]) {
      try {
        found.add(sha256Git(rev, relPath));
      } catch {
        // object missing on that rev
      }
    }
    assert.ok(found.has(expected), `unresolvable sha256 for ${relPath}`);
  }

  assert.equal(
    sha256Disk("docs/design/evidence/memory-workspace-phase1b-item5-met-decision.json"),
    request.references["docs/design/evidence/memory-workspace-phase1b-item5-met-decision.json"],
  );
  assert.equal(
    sha256Disk(
      ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-unlock-decision.md",
    ),
    request.references[
      ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-unlock-decision.md"
    ],
  );
});
