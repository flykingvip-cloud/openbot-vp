import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { queryObservation } from "./query.js";
let dir = "";
let cfg: OpenBotConfig;
const time = Date.parse("2026-11-06T00:00:00Z");
const row = (version = 1) => ({
  taskId: "task",
  outcomeVersion: version,
  scope: {
    kind: "enterprise",
    tenantId: "tenant",
    enterpriseDomainId: "domain",
    subjectRef: "subject:alice",
    authzScopeRef: "auth",
  },
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt: new Date(time).toISOString(),
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [],
  attempts: [],
});
const query = (extra = {}) =>
  queryObservation({
    cfg,
    caller: { subjectRef: "subject:alice", tenantId: "tenant" },
    agentId: "bot",
    taskId: "task",
    outcomeVersion: 1,
    from: time,
    to: time + 1,
    projectedAt: time + 1,
    ...extra,
  });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "observation-query-"));
  cfg = { agents: { list: [{ id: "bot", agentDir: dir }] } } as OpenBotConfig;
  fs.mkdirSync(path.join(dir, "task-outcomes/tips"), { recursive: true });
  fs.mkdirSync(path.join(dir, "task-outcomes/versions"));
  fs.writeFileSync(path.join(dir, "task-outcomes/tips/task.json"), JSON.stringify(row()));
  fs.writeFileSync(path.join(dir, "task-outcomes/versions/task__v1.json"), JSON.stringify(row()));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe("internal observation query", () => {
  it("returns outcome-only evidence, unknown provenance and gated metrics without writes", () => {
    const before = fs.readdirSync(dir, { recursive: true });
    const result = query({ provenance: "live", executions: [{ runId: "fake" }] });
    expect(result.ok).toBe(true);
    if (!result.ok || !("samples" in result)) {
      throw new Error("query_failed");
    }
    expect(result.samples[0].qualification).toBe("outcome_only");
    expect(result.samples[0].provenance).toEqual(["unknown"]);
    expect(result.samples[0].executionRefs).toEqual([]);
    expect(result.metrics.map((m) => m.value)).toEqual([null, null, 0]);
    expect(result.coverage.events.state).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("subject:alice");
    expect(fs.readdirSync(dir, { recursive: true })).toEqual(before);
  });
  it("rechecks caller scope on every query", () => {
    expect(query().ok).toBe(true);
    expect(query({ caller: { subjectRef: "subject:bob", tenantId: "tenant" } })).toEqual({
      ok: false,
      code: "unauthorized",
    });
    expect(query({ caller: { subjectRef: "subject:alice", tenantId: "other" } })).toEqual({
      ok: false,
      code: "unauthorized",
    });
  });
  it("keeps historical versions out of business metrics", () => {
    fs.writeFileSync(path.join(dir, "task-outcomes/tips/task.json"), JSON.stringify(row(2)));
    const result = query();
    if (!result.ok || !("samples" in result)) {
      throw new Error("query_failed");
    }
    expect(result.samples[0].outcome?.isCurrentTip).toBe(false);
    expect(result.metrics[1].reasons).toContain("historical_version_excluded");
  });
  it("filters the half-open window and reports empty coverage without fake zero", () => {
    const result = query({ from: time - 1, to: time });
    if (!result.ok || !("samples" in result)) {
      throw new Error("query_failed");
    }
    expect(result.samples).toEqual([]);
    expect(result.coverage.link).toBeNull();
    expect(result.coverage.attemptedCount).toBe(0);
    expect(result.metrics.every((m) => m.value === null)).toBe(true);
  });
  it("rejects unbounded or future windows and missing tasks", () => {
    expect(query({ from: time - 31 * 86400000 })).toEqual({ ok: false, code: "invalid_window" });
    expect(query({ projectedAt: time })).toEqual({ ok: false, code: "invalid_window" });
    expect(query({ taskId: "missing" })).toEqual({ ok: false, code: "not_found" });
  });
});
