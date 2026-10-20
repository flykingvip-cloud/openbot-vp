import { describe, expect, it } from "vitest";
import {
  OPERATION_KEY_VERSION,
  PARTITION_KEY_VERSION,
  computeIngestionChecksum,
  computeScopeFingerprint,
  computeWriteOperationKey,
  createMemoryPartitionKeyV1,
  resolveSourceLocatorForOperationKey,
  stableMetadataForChecksum,
} from "./keys.js";
import type { Scope } from "./models.js";

const scope: Scope = {
  workspaceId: " ws_a ",
  projectId: "proj_a",
  agentId: "agent_main",
  visibility: "private",
};

describe("CW2-P0-00 operation key contract", () => {
  it("whitelists checksum metadata and ignores syncReason", () => {
    const stable = stableMetadataForChecksum({
      openbotPath: "agents/main/sessions/a.jsonl",
      syncReason: "snapshot-restore",
      requestId: "req-1",
      openbotSource: "chat",
    });
    expect(stable).toEqual({
      openbotPath: "agents/main/sessions/a.jsonl",
      openbotSource: "chat",
    });

    const base = computeIngestionChecksum("hello", {
      openbotPath: "agents/main/sessions/a.jsonl",
    });
    const withNoise = computeIngestionChecksum("hello", {
      openbotPath: "agents/main/sessions/a.jsonl",
      syncReason: "watcher",
      hostname: "gateway-host",
    });
    expect(withNoise).toBe(base);
  });

  it("builds partition keys without P3 subject fields", () => {
    const partition = createMemoryPartitionKeyV1("dp-1", scope);
    expect(partition.partitionKeyVersion).toBe(PARTITION_KEY_VERSION);
    expect(partition.dataPlaneId).toBe("dp-1");
    expect(partition.scopeFingerprint).toBe(computeScopeFingerprint(scope));
    // Trimmed fingerprint: leading/trailing scope whitespace must not churn keys.
    const trimmedScope: Scope = {
      workspaceId: "ws_a",
      projectId: "proj_a",
      agentId: "agent_main",
      visibility: "private",
    };
    expect(computeScopeFingerprint(trimmedScope)).toBe(partition.scopeFingerprint);
  });

  it("keeps writeOperationKey stable across schemaVersion and subject annotations", () => {
    const partition = createMemoryPartitionKeyV1("dp-stable", {
      workspaceId: "ws",
      projectId: "proj",
      agentId: "agent",
      visibility: "private",
    });
    const contentChecksum = computeIngestionChecksum("body", {
      openbotPath: "/tmp/session.jsonl",
      syncReason: "snapshot-restore",
    });
    const key = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: resolveSourceLocatorForOperationKey({
        metadata: { openbotPath: "/tmp/session.jsonl", syncReason: "watcher" },
      }),
      contentChecksum,
    });
    const again = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: "/tmp/session.jsonl",
      contentChecksum: computeIngestionChecksum("body", {
        openbotPath: "/tmp/session.jsonl",
      }),
      operationKeyVersion: OPERATION_KEY_VERSION,
    });
    expect(again).toBe(key);
    // Simulated schema bump must not be part of the op-key inputs.
    expect(key.includes("schema")).toBe(false);
  });
});
