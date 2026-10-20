import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(import.meta.filename), "../../..");

void test("Memory Asset resourceId is independent and binds sourceWorkspaceResourceId", () => {
  const register = fs.readFileSync(
    path.join(ROOT, "src/gateway/data-governance/memory-register.ts"),
    "utf8",
  );
  const cogni = fs.readFileSync(path.join(ROOT, "src/memory/cogniweave-manager.ts"), "utf8");

  assert.match(register, /function buildMemoryResourceId\(/);
  assert.match(register, /return `memory:\$\{tenant\}:atom:/);
  assert.match(register, /return `memory:\$\{tenant\}:source:/);
  assert.match(register, /sourceWorkspaceResourceId: params\.sourceWorkspaceResourceId \?\? null,/);
  assert.match(register, /const resourceId = buildMemoryResourceId\(/);
  assert.doesNotMatch(register, /resourceId: params\.sourceWorkspaceResourceId/);
  assert.match(cogni, /this\.workspaceId = stableId\("ws", path\.resolve\(this\.stateDir\)\);/);

  const workspaceResourceId = "ws:t1:user:u1:asset:a1";
  const memoryResourceId = "memory:t1:source:src-1";
  assert.notEqual(workspaceResourceId, memoryResourceId);
  assert.match(workspaceResourceId, /^ws:/);
  assert.match(memoryResourceId, /^memory:/);
  const projection = { sourceWorkspaceResourceId: workspaceResourceId };
  assert.equal(projection.sourceWorkspaceResourceId, workspaceResourceId);
  assert.notEqual(memoryResourceId, projection.sourceWorkspaceResourceId);
});
