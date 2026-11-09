import assert from "node:assert/strict";
/** Local-only reproducible retention probe. All disk writes stay in a temporary directory. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFabricAuditStore } from "../../../src/fabric/audit-store.js";
import { buildExecutionRecord } from "../../../src/fabric/audit.js";
import { createExecutionJournal } from "../../../src/observation/execution-journal.js";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "p4-retention-probe-"));
const scope = {
  kind: "personal",
  personalDomainId: "fixture",
  subjectRef: "subject:fixture",
  authzScopeRef: "fixture",
} as const;
let at = 100;
const capacity = 64;
const start = performance.now();
try {
  const journal = createExecutionJournal({
    rootDir: root,
    enabled: () => true,
    now: () => at,
    capacity,
    ttlMs: 100,
    maxBytes: 1048576,
  });
  for (let i = 0; i < 256; i++) {
    assert.equal(
      (
        await journal.appendFact({
          agentId: "fixture",
          fact: {
            eventId: "e" + i,
            taskId: "task",
            runId: "run",
            scope,
            occurredAt: 100,
            stage: "started",
            source: { provenance: "injected", collector: "test" },
          },
        })
      ).ok,
      true,
    );
  }
  const result = await journal.query({ agentId: "fixture", scope });
  assert(result.ok);
  assert.equal(result.facts.length, 64);
  assert.equal(result.watermark.discardedThrough, 192);
  const [file] = await fs.readdir(root);
  const bytes = (await fs.stat(path.join(root, file))).size;
  const restarted = await createExecutionJournal({
    rootDir: root,
    enabled: () => true,
    now: () => at,
    capacity,
    ttlMs: 100,
    maxBytes: 1048576,
  }).query({ agentId: "fixture", scope });
  assert(restarted.ok);
  assert.equal(restarted.facts.length, 64);
  const before = await fs.readFile(path.join(root, file), "utf8");
  at = 200;
  const expired = await journal.query({ agentId: "fixture", scope });
  assert(expired.ok);
  assert.equal(expired.facts.length, 0);
  assert.equal(expired.watermark.discardedThrough, 256);
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), before);
  await fs.writeFile(path.join(root, "interrupted.tmp"), "{");
  assert((await journal.query({ agentId: "fixture", scope })).ok);
  const small = createExecutionJournal({
    rootDir: path.join(root, "small"),
    enabled: () => true,
    now: () => 100,
    maxBytes: 1024,
  });
  let limitReason = "";
  for (let i = 0; i < 30; i++) {
    const r = await small.appendFact({
      agentId: "fixture",
      fact: {
        eventId: "b" + i,
        taskId: "task",
        runId: "run",
        scope,
        occurredAt: 100,
        stage: "started",
      },
    });
    if (!r.ok) {
      limitReason = r.reason;
      break;
    }
  }
  assert(["journal_capacity", "journal_write_unknown"].includes(limitReason));
  await fs.writeFile(path.join(root, file), "{broken");
  const corrupt = await journal.query({ agentId: "fixture", scope });
  assert.equal(corrupt.ok, false);
  const fabric = createFabricAuditStore(64);
  for (let i = 0; i < 256; i++) {
    fabric.append(
      buildExecutionRecord({
        request: {
          id: "r" + i,
          source: { type: "cursor", tenantId: "fixture" },
          tool: { name: "fixture" },
          input: {},
          context: {},
          trace: { sessionId: "fixture", correlationId: "c" + i },
        },
        decision: { decision: "ALLOW", matchedRules: [], decisionTrace: [] },
        result: {
          id: "r" + i,
          status: "success",
          output: {},
          timing: { start: 1, end: 2 },
          trace: { policyDecisionId: "fixture", executionId: "x" + i },
        },
      }),
    );
  }
  assert.equal(fabric.size(), 64);
  assert.equal(createFabricAuditStore(64).size(), 0);
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        environment: "isolated_injected_local",
        journal: {
          inserted: 256,
          capacity,
          retained: 64,
          discardedThrough: 192,
          bytes,
          ttlExpiredRetained: 0,
          ttlDiscardedThrough: 256,
          readDidNotWrite: true,
          restartRetained: 64,
          smallBudgetRejection: limitReason,
          corruptRead: "unknown",
          partialTmpIgnored: true,
        },
        fabric: {
          inserted: 256,
          capacity: 64,
          retained: 64,
          restartRetained: 0,
          ttl: "not_implemented",
          watermark: "not_implemented",
        },
        elapsedMs: performance.now() - start,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
