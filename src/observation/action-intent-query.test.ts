import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { queryActionIntents } from "./action-intent-query.js";
import { createActionIntentStore } from "./action-intent-store.js";
import { createActionIntent } from "./action-intent.js";
let root = "";
let cfg: OpenBotConfig;
const scope = {
  kind: "enterprise",
  tenantId: "tenant",
  enterpriseDomainId: "domain",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
} as const;
const row = {
  taskId: "task",
  outcomeVersion: 1,
  scope,
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt: "2026-11-06T00:00:00Z",
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [],
  attempts: [],
};
const fresh = (id: string) =>
  createActionIntent(
    {
      actionIntentId: id,
      findingRef: { findingId: "finding", source: "rule_v1" },
      target: {
        controlPlane: "evolution",
        targetType: "agent",
        targetId: "bot",
        scopeRef: "tenant",
        expectedConfigVersion: "v1",
        diffDigest: "diff",
        previewRef: "preview",
        rollbackPointRef: "point",
        rollbackExpectedVersion: "v0",
        rollbackDiffDigest: "old",
      },
      evidence: {
        sampleRefs: [{ sampleId: "sample", taskId: "task", outcomeVersion: 1 }],
        metricDictVersion: 1,
        metricId: "metric",
        denominatorDefinition: "tips",
        cohortRef: "cohort",
        window: { from: 0, to: 1 },
        eligibility: "unknown",
        improvementEligible: false,
        environment: "test",
        provenance: "injected",
        reasons: [],
      },
    },
    1,
  );
const args = () => ({
  cfg,
  caller: { subjectRef: "subject:a", tenantId: "tenant" },
  agentId: "bot",
  taskId: "task",
  outcomeVersion: 1,
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "intent-query-"));
  const agentDir = path.join(root, "agent");
  await fs.mkdir(path.join(agentDir, "task-outcomes/tips"), { recursive: true });
  await fs.mkdir(path.join(agentDir, "task-outcomes/versions"));
  await fs.writeFile(path.join(agentDir, "task-outcomes/tips/task.json"), JSON.stringify(row));
  await fs.writeFile(
    path.join(agentDir, "task-outcomes/versions/task__v1.json"),
    JSON.stringify(row),
  );
  cfg = { agents: { list: [{ id: "bot", agentDir }] } };
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
describe("scoped read-only intent query", () => {
  it("returns unknown without creating a store and rejects forged caller", async () => {
    const store = createActionIntentStore(path.join(root, "missing"));
    const result = await queryActionIntents(args(), store);
    expect(result.ok && "state" in result && result.state).toBe("unknown");
    expect(await fs.readdir(root)).toEqual(["agent"]);
    expect(
      await queryActionIntents(
        { ...args(), caller: { subjectRef: "other", tenantId: "tenant" } },
        store,
      ),
    ).toEqual({ ok: false, code: "unauthorized" });
  });
  it("pages stably and labels injected details non-production", async () => {
    const store = createActionIntentStore(path.join(root, "store"));
    for (const id of ["one", "two", "three"]) {
      await store.commit({
        scope,
        intent: fresh(id),
        expectedRevision: -1,
        commandId: id,
        requestDigest: id,
      });
    }
    const first = await queryActionIntents({ ...args(), limit: 1 }, store);
    if (!first.ok || !("items" in first)) {
      throw new Error("failed");
    }
    expect(first.items).toHaveLength(1);
    expect(first.items[0].source.nonProduction).toBe(true);
    const second = await queryActionIntents(
      { ...args(), limit: 1, cursor: first.nextCursor! },
      store,
    );
    if (!second.ok || !("items" in second)) {
      throw new Error("failed");
    }
    expect(second.items[0].actionIntentId).not.toBe(first.items[0].actionIntentId);
    const detail = await queryActionIntents({ ...args(), intentId: "one" }, store);
    expect(JSON.stringify(detail)).not.toContain("subject:a");
    expect(JSON.stringify(detail)).not.toContain("authzScopeRef");
    await store.commit({
      scope,
      intent: fresh("four"),
      expectedRevision: -1,
      commandId: "four",
      requestDigest: "four",
    });
    expect(await queryActionIntents({ ...args(), cursor: first.nextCursor! }, store)).toEqual({
      ok: false,
      code: "intent_read_failed",
    });
  });
  it("rejects malformed pagination and revision parameters", async () => {
    const store = createActionIntentStore(path.join(root, "store"));
    for (const extra of [
      { limit: 0 },
      { limit: 101 },
      { revision: 1 },
      { intentId: "one", revision: -1 },
      { cursor: "" },
      { intentId: "one", limit: 1 },
    ]) {
      expect(await queryActionIntents({ ...args(), ...extra }, store)).toEqual({
        ok: false,
        code: "invalid_intent_query",
      });
    }
  });
  it("rechecks ownership after asynchronous reads", async () => {
    const store = createActionIntentStore(path.join(root, "store"));
    const wrapped = {
      detail: (...a: Parameters<typeof store.detail>) => store.detail(...a),
      list: async (...a: Parameters<typeof store.list>) => {
        const result = await store.list(...a);
        const agentDir = cfg.agents!.list![0].agentDir!;
        await fs.writeFile(
          path.join(agentDir, "task-outcomes/tips/task.json"),
          JSON.stringify({ ...row, scope: { ...scope, subjectRef: "revoked" } }),
        );
        return result;
      },
    };
    expect(await queryActionIntents(args(), wrapped)).toEqual({ ok: false, code: "unauthorized" });
  });
});
