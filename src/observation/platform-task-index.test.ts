import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createExecutionEvidenceStore } from "./execution-evidence-store.js";
import { queryPlatformTaskIndex } from "./platform-task-index.js";

let dir = "";
let cfg: OpenBotConfig;
const time = Date.parse("2026-11-06T00:00:00Z");
const enterprise = {
  kind: "enterprise" as const,
  tenantId: "tenant-a",
  enterpriseDomainId: "domain",
  subjectRef: "subject:alice",
  authzScopeRef: "auth",
};
const other = {
  ...enterprise,
  tenantId: "tenant-b",
};
const row = (taskId: string, scope = enterprise, decidedAt = new Date(time).toISOString()) => ({
  taskId,
  outcomeVersion: 1,
  scope,
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt,
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [{ runId: "run", attemptIds: ["attempt"], effectiveAttemptId: "attempt", status: "succeeded" }],
  attempts: [
    {
      attemptId: "attempt",
      runId: "run",
      status: "succeeded",
      observedAt: decidedAt,
    },
  ],
});

function writeTip(record: ReturnType<typeof row>) {
  fs.writeFileSync(path.join(dir, "task-outcomes/tips", `${record.taskId}.json`), JSON.stringify(record));
  fs.writeFileSync(
    path.join(dir, "task-outcomes/versions", `${record.taskId}__v1.json`),
    JSON.stringify(record),
  );
}

describe("platform task index", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-task-index-"));
    cfg = { agents: { list: [{ id: "bot", agentDir: dir }] } } as OpenBotConfig;
    fs.mkdirSync(path.join(dir, "task-outcomes/tips"), { recursive: true });
    fs.mkdirSync(path.join(dir, "task-outcomes/versions"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lists compact tasks for granted tenants and omits task bodies and subject refs", () => {
    writeTip(row("task-a"));
    writeTip(row("task-b", other));
    const index = queryPlatformTaskIndex({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      grantedTenantIds: ["tenant-a"],
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
    });
    expect(index.ok).toBe(true);
    if (!index.ok) {
      throw new Error("index_failed");
    }
    expect(index.authorization).toBe("granted");
    expect(index.tasks.map((task) => task.taskId)).toEqual(["task-a"]);
    expect(index.tasks[0]).toMatchObject({
      agentId: "bot",
      outcomeVersion: 1,
      tenantId: "tenant-a",
    });
    expect(JSON.stringify(index)).not.toContain("subject:alice");
    expect(JSON.stringify(index)).not.toContain("task-b");
  });

  it("does not confirm existence for an ungranted tenant filter", () => {
    writeTip(row("task-b", other));
    const index = queryPlatformTaskIndex({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      tenantId: "tenant-b",
      grantedTenantIds: ["tenant-a"],
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
    });
    expect(index.ok).toBe(true);
    if (!index.ok) {
      throw new Error("index_failed");
    }
    expect(index.authorization).toBe("unknown");
    expect(index.tasks).toEqual([]);
    expect(JSON.stringify(index)).not.toContain("task-b");
    expect(JSON.stringify(index)).not.toContain("none");
    expect(JSON.stringify(index)).not.toContain("no_grant");
  });

  it("filters by agent and date window without inventing coverage", () => {
    writeTip(row("task-a"));
    writeTip(row("task-old", enterprise, new Date(time - 10_000).toISOString()));
    const index = queryPlatformTaskIndex({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      agentId: "bot",
      grantedTenantIds: ["tenant-a"],
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
    });
    expect(index.ok).toBe(true);
    if (!index.ok) {
      throw new Error("index_failed");
    }
    expect(index.tasks.map((task) => task.taskId)).toEqual(["task-a"]);
    const missing = queryPlatformTaskIndex({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      agentId: "other-bot",
      grantedTenantIds: ["tenant-a"],
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
    });
    expect(missing.ok).toBe(true);
    if (!missing.ok) {
      throw new Error("index_failed");
    }
    expect(missing.tasks).toEqual([]);
  });
});
