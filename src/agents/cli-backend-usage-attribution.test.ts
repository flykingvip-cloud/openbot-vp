import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordCliBackendUsage,
  queryCliBackendUsage,
  type UsageAttribution,
} from "./cli-backend-usage-attribution.js";

describe("recordCliBackendUsage (append-only attribution, no plaintext)", () => {
  let dir: string;
  let storePath: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cli-usage-"));
    storePath = path.join(dir, "usage.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends a JSONL record with the attribution tuple + occurredAt", async () => {
    await recordCliBackendUsage(
      {
        tenantId: "t1",
        userId: "seat-9",
        backendId: "claude-cli",
        credentialId: "corp",
        model: "claude-sonnet",
        executionId: "run-1",
      },
      { storePath },
    );
    const lines = readFileSync(storePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]) as UsageAttribution;
    expect(rec.tenantId).toBe("t1");
    expect(rec.userId).toBe("seat-9");
    expect(rec.backendId).toBe("claude-cli");
    expect(rec.credentialId).toBe("corp");
    expect(rec.model).toBe("claude-sonnet");
    expect(rec.executionId).toBe("run-1");
    expect(typeof rec.occurredAt).toBe("string");
    // never records a secret value — only the credential id.
    expect(JSON.stringify(rec)).not.toContain("sk-");
  });

  it("appends (does not overwrite) across multiple runs", async () => {
    await recordCliBackendUsage(
      { tenantId: "t1", userId: "u", backendId: "b", credentialId: "c1", executionId: "r1" },
      { storePath },
    );
    await recordCliBackendUsage(
      { tenantId: "t1", userId: "u", backendId: "b", credentialId: "c2", executionId: "r2" },
      { storePath },
    );
    const lines = readFileSync(storePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("is best-effort: an unwritable path does not throw", async () => {
    await expect(
      recordCliBackendUsage(
        { tenantId: "t1", userId: "u", backendId: "b", credentialId: "c", executionId: "r" },
        { storePath: "/" },
      ),
    ).resolves.toBeUndefined();
  });

  it("queryCliBackendUsage filters by executionId prefix and tenant", async () => {
    await recordCliBackendUsage(
      {
        tenantId: "t1",
        userId: "u",
        backendId: "b",
        credentialId: "c1",
        executionId: "sup_1:run-a",
      },
      { storePath },
    );
    await recordCliBackendUsage(
      {
        tenantId: "t1",
        userId: "u",
        backendId: "b",
        credentialId: "c2",
        executionId: "sup_2:run-b",
      },
      { storePath },
    );
    await recordCliBackendUsage(
      {
        tenantId: "t2",
        userId: "u",
        backendId: "b",
        credentialId: "c3",
        executionId: "sup_1:run-c",
      },
      { storePath },
    );
    const matches = await queryCliBackendUsage({
      storePath,
      tenantId: "t1",
      executionIdPrefix: "sup_1",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.executionId).toBe("sup_1:run-a");
  });
});
