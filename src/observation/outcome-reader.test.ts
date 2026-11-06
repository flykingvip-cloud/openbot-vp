import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readOutcomeMetadata } from "./outcome-reader.js";

let dir = "";
let cfg: OpenBotConfig;
const taskId = "task/../encoded";
const metadata = (version = 1) => ({
  taskId,
  outcomeVersion: version,
  scope: {
    kind: "enterprise",
    subjectRef: "subject:alice",
    authzScopeRef: "auth",
    tenantId: "tenant",
    enterpriseDomainId: "domain",
  },
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt: "2026-11-06T00:00:00Z",
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [],
  attempts: [],
  reasonDetail: "PRIVATE",
});
const tipPath = () => path.join(dir, "task-outcomes/tips", encodeURIComponent(taskId) + ".json");
const versionPath = () =>
  path.join(dir, "task-outcomes/versions", encodeURIComponent(taskId) + "__v1.json");
const read = (extra = {}) =>
  readOutcomeMetadata({
    cfg,
    agentId: "bot",
    taskId,
    outcomeVersion: 1,
    callerSubjectRef: "subject:alice",
    callerTenantId: "tenant",
    ...extra,
  });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-read-"));
  cfg = { agents: { list: [{ id: "bot", agentDir: dir }] } } as OpenBotConfig;
  fs.mkdirSync(path.join(dir, "task-outcomes/tips"), { recursive: true });
  fs.mkdirSync(path.join(dir, "task-outcomes/versions"));
  fs.writeFileSync(tipPath(), JSON.stringify(metadata()));
  fs.writeFileSync(versionPath(), JSON.stringify(metadata()));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});
describe("read-only outcome metadata", () => {
  it("reads encoded keys without writes and strips private fields", () => {
    const before = fs.readdirSync(path.join(dir, "task-outcomes"), { recursive: true });
    const tipBefore = fs.readFileSync(tipPath(), "utf8");
    const versionBefore = fs.readFileSync(versionPath(), "utf8");
    const result = read();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(fs.readdirSync(path.join(dir, "task-outcomes"), { recursive: true })).toEqual(before);
    expect(fs.readFileSync(tipPath(), "utf8")).toBe(tipBefore);
    expect(fs.readFileSync(versionPath(), "utf8")).toBe(versionBefore);
  });
  it("labels history rather than pairing it with the current tip", () => {
    fs.writeFileSync(tipPath(), JSON.stringify(metadata(2)));
    const result = read();
    expect(result.ok && result.outcome.isCurrentTip).toBe(false);
  });
  it("rejects forged subject and tenant and agent path fragments", () => {
    expect(read({ callerSubjectRef: "subject:bob" })).toEqual({ ok: false, code: "unauthorized" });
    expect(read({ callerTenantId: "other" })).toEqual({ ok: false, code: "unauthorized" });
    expect(read({ agentId: "../bot" })).toEqual({ ok: false, code: "agent_unresolved" });
  });
  it("fails closed on missing version and conflicting snapshot scope", () => {
    fs.unlinkSync(versionPath());
    expect(read()).toEqual({ ok: false, code: "version_missing" });
    const snap = metadata();
    snap.scope.authzScopeRef = "other";
    fs.writeFileSync(versionPath(), JSON.stringify(snap));
    expect(read()).toEqual({ ok: false, code: "scope_conflict" });
  });
  it("detects a tip advancing during the read", () => {
    const original = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (...args: Parameters<typeof fs.readFileSync>) => {
        if (args[0] === tipPath() && ++reads === 2) {
          return JSON.stringify(metadata(2));
        }
        return original(...args);
      },
    );
    expect(read()).toEqual({ ok: false, code: "tip_changed" });
  });
});
