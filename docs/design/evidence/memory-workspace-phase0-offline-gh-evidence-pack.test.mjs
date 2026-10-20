import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const PACK_PATH = path.join(
  import.meta.dirname,
  "memory-workspace-phase0-offline-gh-evidence-pack.json",
);

const REQUIRED_COMMAND_IDS = [
  "pr409-view",
  "pr409-checks",
  "pr401-view",
  "pr401-checks",
  "ruleset-19808307",
  "actions-runners",
];

void test("offline gh evidence pack has six command captures", () => {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, "utf8"));
  assert.equal(pack.schema, "memory-workspace-phase0-offline-gh-evidence-pack/v1");
  assert.equal(pack.governance.phase0Accepted, false);
  assert.equal(pack.governance.deployAuthorized, false);
  assert.equal(pack.governance.closesWsC, false);

  const ids = new Set(pack.commands.map((c) => c.id));
  for (const id of REQUIRED_COMMAND_IDS) {
    assert.ok(ids.has(id), `missing command capture: ${id}`);
  }

  const pr409 = pack.commands.find((c) => c.id === "pr409-view");
  assert.equal(pr409.parsed.state, "MERGED");
  assert.equal(pr409.parsed.reviewDecision, "APPROVED");

  const pr401 = pack.commands.find((c) => c.id === "pr401-view");
  assert.equal(pr401.parsed.state, "MERGED");
  assert.equal(pr401.parsed.headRefOid, "bb19e42032890bd22a419aa449c8b5ef63959a52");

  const ruleset = pack.commands.find((c) => c.id === "ruleset-19808307");
  const required = ruleset.parsed.rules.find((r) => r.type === "required_status_checks");
  const contexts = required.parameters.required_status_checks.map((c) => c.context);
  assert.deepEqual(contexts, [
    "delivery guard",
    "check (types, lint, format)",
    "freeze + phase0 evidence tests",
  ]);

  const runners = pack.commands.find((c) => c.id === "actions-runners");
  assert.ok(runners.parsed.total_count >= 1);
});
