import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "../../../src/memory/item6-authorized-sqlite-path.ts";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item6-implementation-start.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("Item 6 implementation start gate stays fail-closed without authorized path", () => {
  const packet = load(PACKET);
  const current = load(CURRENT);
  assert.equal(packet.item6, "not-met");
  assert.equal(packet.item6ImplementationUnlocked, true);
  assert.equal(packet.productionSqliteWrite, false);
  assert.equal(current.item6ImplementationUnlocked, true);
  assert.equal(fs.existsSync(path.join(REPO, packet.runtime)), true);
  assert.equal(classifyAuthorizedSqlitePath({}).status, "unconfigured");
});
