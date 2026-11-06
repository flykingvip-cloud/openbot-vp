import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
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
  it("supports owned personal scope", () => {
    const personal = {
      ...metadata(),
      scope: {
        kind: "personal",
        subjectRef: "subject:alice",
        authzScopeRef: "personal-auth",
        personalDomainId: "personal-domain",
      },
    };
    fs.writeFileSync(tipPath(), JSON.stringify(personal));
    fs.writeFileSync(versionPath(), JSON.stringify(personal));
    expect(read({ callerTenantId: null }).ok).toBe(true);
    expect(read({ callerSubjectRef: "subject:other" })).toEqual({
      ok: false,
      code: "unauthorized",
    });
  });
  it.each(["authzScopeRef", "enterpriseDomainId"])("rejects empty scope field %s", (key) => {
    const invalid = { ...metadata(), scope: { ...metadata().scope, [key]: " " } };
    fs.writeFileSync(tipPath(), JSON.stringify(invalid));
    fs.writeFileSync(versionPath(), JSON.stringify(invalid));
    expect(read()).toEqual({ ok: false, code: "invalid_record" });
  });
  it("rejects conflicting business metadata under the same immutable version", () => {
    fs.writeFileSync(versionPath(), JSON.stringify({ ...metadata(), taskJudgement: "failure" }));
    expect(read()).toEqual({ ok: false, code: "invalid_record" });
  });
  it("uses bounded hash paths for long task identities", () => {
    const longId = "任务".repeat(300);
    const segment = boundedOutcomePathSegment(longId);
    expect(segment).toMatch(/^h-[a-f0-9]{64}$/);
    const row = { ...metadata(), taskId: longId };
    fs.writeFileSync(path.join(dir, "task-outcomes/tips", segment + ".json"), JSON.stringify(row));
    fs.writeFileSync(
      path.join(dir, "task-outcomes/versions", segment + "__v1.json"),
      JSON.stringify(row),
    );
    expect(read({ taskId: longId }).ok).toBe(true);
  });
  it("does not create a missing store on read failure", () => {
    fs.rmSync(path.join(dir, "task-outcomes"), { recursive: true });
    expect(read()).toEqual({ ok: false, code: "not_found" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it("rejects malformed consumed metadata", () => {
    fs.writeFileSync(
      versionPath(),
      JSON.stringify({ ...metadata(), attempts: [{ attemptId: 7 }] }),
    );
    expect(read()).toEqual({ ok: false, code: "invalid_record" });
  });
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
