import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionStoreMetadata, readSkillInvocationStoreRows } from "./store-readers.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Phase 1 increment 3.6 — read-only store readers", () => {
  it("reads Skill events.jsonl through readSkillInvocationEvents without appending", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-skill-store-"));
    tmpDirs.push(configDir);
    const eventsDir = path.join(configDir, "skill-invocation-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, "events.jsonl"),
      `${JSON.stringify({
        type: "skill_invocation_completed",
        invocationId: "inv-store-1",
        skillId: "skill-fixture-lookup",
        skillVersion: "1.0.0",
        agentId: "agent-fixture-main",
        tenantId: "tenant-fixture-a",
        userId: null,
        startedAt: Date.parse("2026-09-01T11:00:00.000Z"),
        completedAt: Date.parse("2026-09-01T11:00:01.000Z"),
        outcome: "success",
        latencyMs: 1000,
        failureCategory: null,
        runId: "agent-run-store-1",
        sessionKey: "session-store-1",
        businessOutcome: null,
        toolName: "lookup",
        attributionResolution: "unique_owner",
      })}\n`,
      "utf8",
    );

    const rows = readSkillInvocationStoreRows({ configDir });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invocationId).toBe("inv-store-1");
    expect(rows[0]?.skillStarted).toBe(true);
    expect(rows[0]?.attributionResolution).toBe("unique_owner");
    expect(rows[0]?.outcome).toBe("success");
  });

  it("reads Session JSONL metadata only and never copies message body", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnosis-session-store-"));
    tmpDirs.push(dir);
    const sessionFilePath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFilePath,
      [
        JSON.stringify({ type: "session-meta", agentId: "agent-fixture-main" }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: "secret inbound text" },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: "secret reply" },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: "secret retry" },
        }),
      ].join("\n"),
      "utf8",
    );

    const row = readSessionStoreMetadata({
      sessionFilePath,
      sessionId: "session-store-1",
      sessionKeyHash: "sha256:fixture-session-key-store",
      agentId: "agent-fixture-main",
      observedAt: "2026-09-01T10:00:02.000Z",
    });
    expect(row).toEqual({
      sessionId: "session-store-1",
      sessionKeyHash: "sha256:fixture-session-key-store",
      agentId: "agent-fixture-main",
      messageReceived: true,
      retryCount: 1,
      observedAt: "2026-09-01T10:00:02.000Z",
      authorityRecordId: "session-jsonl:sha256:fixture-session-key-store",
    });
    expect(JSON.stringify(row)).not.toContain("secret");
  });
});
