import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushVaultSyncRevisionNotificationsForTest,
  notifyVaultSyncRevisionsAvailable,
  setVaultSyncRevisionEventSink,
  type VaultSyncRevisionsAvailablePayload,
} from "./events.js";

afterEach(() => {
  setVaultSyncRevisionEventSink(null);
});

describe("vault-sync revision events", () => {
  it("does nothing when no sink is registered", () => {
    expect(() =>
      notifyVaultSyncRevisionsAvailable({
        vaultId: "v1",
        revisionId: "r1",
        opaquePathId: "p1",
        sourceDeviceId: "d1",
        serverReceivedAt: "2026-07-22T00:00:00.000Z",
        status: "accepted",
      }),
    ).not.toThrow();
  });

  it("coalesces multiple commits for the same vault into one frame", async () => {
    const seen: VaultSyncRevisionsAvailablePayload[] = [];
    setVaultSyncRevisionEventSink((payload) => {
      seen.push(payload);
    });

    notifyVaultSyncRevisionsAvailable({
      vaultId: "v1",
      revisionId: "r1",
      opaquePathId: "p1",
      sourceDeviceId: "d1",
      serverReceivedAt: "2026-07-22T00:00:01.000Z",
      status: "accepted",
    });
    notifyVaultSyncRevisionsAvailable({
      vaultId: "v1",
      revisionId: "r2",
      opaquePathId: "p2",
      sourceDeviceId: "d1",
      serverReceivedAt: "2026-07-22T00:00:02.000Z",
      status: "conflict",
    });

    expect(seen).toHaveLength(0);
    flushVaultSyncRevisionNotificationsForTest();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: "revisions_available",
      vaultId: "v1",
      cursor: "r2",
      revisionIds: ["r1", "r2"],
      opaquePathIds: ["p1", "p2"],
      sourceDeviceId: "d1",
      status: "conflict",
    });
    // No plaintext paths / blobs
    expect(JSON.stringify(seen[0])).not.toMatch(/content|plaintext|\/Users\//i);
  });

  it("auto-flushes after the coalesce window", async () => {
    vi.useFakeTimers();
    const seen: VaultSyncRevisionsAvailablePayload[] = [];
    setVaultSyncRevisionEventSink((payload) => {
      seen.push(payload);
    });
    notifyVaultSyncRevisionsAvailable({
      vaultId: "v2",
      revisionId: "r9",
      opaquePathId: "px",
      sourceDeviceId: "d9",
      serverReceivedAt: "2026-07-22T00:00:09.000Z",
      status: "accepted",
    });
    expect(seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.revisionIds).toEqual(["r9"]);
    vi.useRealTimers();
  });
});
