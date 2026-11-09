import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createCapacityReader } from "./capacity-reader.js";
let root = "";
let cfg: OpenBotConfig;
const now = Date.parse("2026-11-06T00:00:00Z");
const scope = {
  kind: "enterprise",
  tenantId: "tenant",
  enterpriseDomainId: "domain",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
};
const row = {
  taskId: "task",
  outcomeVersion: 1,
  scope,
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt: new Date(now).toISOString(),
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [],
  attempts: [],
};
const snapshot = () => ({
  version: 1,
  activeByEnterprise: { tenant: "s1" },
  snapshots: {
    s1: {
      id: "s1",
      enterpriseId: "tenant",
      subscriptionId: "sub",
      planVersionId: "pv1",
      effectiveAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 1000).toISOString(),
      entitlementSnapshot: {
        maxConcurrentRuns: 5,
        concurrencyPolicy: { includedRuns: 5, maxBurstRuns: 0, mode: "block" },
      },
    },
  },
});
const write = (name: string, value: unknown) =>
  fs.writeFile(path.join(root, name), JSON.stringify(value));
const args = () => ({
  cfg,
  caller: { subjectRef: "subject:a", tenantId: "tenant" },
  agentId: "bot",
  taskId: "task",
  outcomeVersion: 1,
  sampledAt: now,
  projectedAt: now,
  maxAgeMs: 100,
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "capacity-read-"));
  const agentDir = path.join(root, "agent");
  await fs.mkdir(path.join(agentDir, "task-outcomes/tips"), { recursive: true });
  await fs.mkdir(path.join(agentDir, "task-outcomes/versions"));
  for (const name of ["tips/task.json", "versions/task__v1.json"]) {
    await fs.writeFile(path.join(agentDir, "task-outcomes", name), JSON.stringify(row));
  }
  cfg = { agents: { list: [{ id: "bot", agentDir }] } };
  await write("openbot-agent-run-registry.json", {
    version: 1,
    runs: {
      r: { runId: "r", enterpriseId: "tenant", startedAt: new Date(now - 100).toISOString() },
    },
  });
  await write("openbot-subscription-runtime-snapshots.json", snapshot());
  await write("openbot-billing-subscriptions.json", {
    version: 1,
    subscriptions: {
      sub: {
        id: "sub",
        enterpriseId: "tenant",
        planVersionId: "pv1",
        status: "active",
        startTime: new Date(now - 1000).toISOString(),
        endTime: null,
      },
    },
  });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
describe("read-only capacity source adapter", () => {
  it("reads real formats without modifying files or upgrading unknown provenance", async () => {
    const names = await fs.readdir(root);
    const before = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => fs.readFile(path.join(root, n), "utf8")),
    );
    const result = await createCapacityReader(root)(args());
    if (!result.ok || !("snapshot" in result)) {
      throw new Error("failed");
    }
    expect(result.sources.registry.state).toBe("readable");
    expect(result.sources.entitlement.state).toBe("readable");
    expect(result.snapshot.concurrency.remaining).toBeNull();
    expect(result.snapshot.quota.remaining).toBeNull();
    expect(result.snapshot.health.normal).toBeNull();
    expect(JSON.stringify(result)).not.toContain("subject:a");
    expect(await fs.readdir(root)).toEqual(names);
    expect(
      await Promise.all(
        names
          .filter((n) => n.endsWith(".json"))
          .map((n) => fs.readFile(path.join(root, n), "utf8")),
      ),
    ).toEqual(before);
  });
  it("distinguishes missing and corrupt registry without idle zeros", async () => {
    await fs.unlink(path.join(root, "openbot-agent-run-registry.json"));
    let result = await createCapacityReader(root)(args());
    expect(result.ok && "sources" in result && result.sources.registry.state).toBe("missing");
    await fs.writeFile(path.join(root, "openbot-agent-run-registry.json"), "{");
    result = await createCapacityReader(root)(args());
    expect(result.ok && "sources" in result && result.sources.registry.state).toBe("corrupt");
  });
  it("rejects cross-tenant callers and invalid active subscription bindings", async () => {
    expect(
      await createCapacityReader(root)({
        ...args(),
        caller: { subjectRef: "subject:a", tenantId: "other" },
      }),
    ).toEqual({ ok: false, code: "unauthorized" });
    const data = snapshot();
    data.snapshots.s1.enterpriseId = "other";
    await write("openbot-subscription-runtime-snapshots.json", data);
    const result = await createCapacityReader(root)(args());
    expect(result.ok && "sources" in result && result.sources.entitlement.state).toBe("unknown");
  });
  it("keeps expired snapshots and stale registry evidence unknown", async () => {
    const data = snapshot();
    data.snapshots.s1.expiresAt = new Date(now).toISOString();
    await write("openbot-subscription-runtime-snapshots.json", data);
    const result = await createCapacityReader(root)({ ...args(), staleRunMs: 10 });
    if (!result.ok || !("snapshot" in result)) {
      throw new Error("failed");
    }
    expect(result.sources.entitlement.state).toBe("unknown");
    expect(result.snapshot.concurrency.reasons).toContain("registry_incomplete_or_stale");
    expect(result.snapshot.concurrency.remaining).toBeNull();
  });
});
