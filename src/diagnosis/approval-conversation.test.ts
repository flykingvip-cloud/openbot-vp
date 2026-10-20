import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDiagnosisConversationSession } from "./approval-conversation.js";
import { hashSessionKey } from "./live-run.js";

const roots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-approval-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("diagnosis conversation session resolution", () => {
  it("returns the live session whose hash matches the case report", () => {
    const root = tempDir();
    const tenantDir = path.join(root, "projections", "tenant-fixture-a");
    fs.mkdirSync(tenantDir, { recursive: true });
    const sessionKey = "agent:daibai:case-a";
    fs.writeFileSync(
      path.join(tenantDir, "cdr-case.json"),
      JSON.stringify({
        cases: [{ caseId: "case-a", sessionKeyHash: hashSessionKey(sessionKey) }],
      }),
    );
    const resolved = resolveDiagnosisConversationSession({
      tenantId: "tenant-fixture-a",
      caseId: "case-a",
      bindings: [],
      projectionsDir: path.join(root, "projections"),
      sessionKeys: [sessionKey],
    });
    expect(resolved).toEqual({ ok: true, sessionKey });
  });

  it("refuses when the report exists but the session key is gone", () => {
    const root = tempDir();
    const tenantDir = path.join(root, "projections", "tenant-fixture-a");
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(
      path.join(tenantDir, "cdr-case.json"),
      JSON.stringify({
        cases: [{ caseId: "case-a", sessionKeyHash: hashSessionKey("agent:daibai:missing") }],
      }),
    );
    const resolved = resolveDiagnosisConversationSession({
      tenantId: "tenant-fixture-a",
      signalId: "sig-a",
      caseId: "case-a",
      bindings: [],
      projectionsDir: path.join(root, "projections"),
      sessionKeys: ["agent:daibai:other"],
    });
    expect(resolved).toEqual({ ok: false, reason: "session_key_unavailable" });
  });

  it("does not treat a binding session as open when it is not live", () => {
    const resolved = resolveDiagnosisConversationSession({
      tenantId: "tenant-fixture-a",
      signalId: "sig-a",
      bindings: [{ signalId: "sig-a", sessionKey: "agent:daibai:stale" }],
      projectionsDir: tempDir(),
      sessionKeys: [],
    });
    expect(resolved).toEqual({ ok: false, reason: "session_key_unavailable" });
  });
});
