import { describe, expect, it } from "vitest";
import {
  collaborationCacheKey,
  collaborationRootFingerprint,
  isolateCollaborationStorePath,
} from "./collaboration-index-scope.js";

describe("collaboration index scope", () => {
  it("same group id with different memory dirs does not share a fingerprint or sqlite", () => {
    const tenantA = [{ groupId: "eng", memoryDir: "/data/tenants/a/groups/eng/memory" }];
    const tenantB = [{ groupId: "eng", memoryDir: "/data/tenants/b/groups/eng/memory" }];
    expect(collaborationRootFingerprint(tenantA)).not.toBe(collaborationRootFingerprint(tenantB));
    const pathA = isolateCollaborationStorePath("/state/index.sqlite", tenantA);
    const pathB = isolateCollaborationStorePath("/state/index.sqlite", tenantB);
    expect(pathA).not.toBe(pathB);
    expect(pathA).not.toBe("/state/index.sqlite");
    expect(isolateCollaborationStorePath("/state/index.sqlite", [])).toBe("/state/index.sqlite");
  });

  it("cache keys differ by caller identity even when the root set matches", () => {
    const roots = [{ groupId: "eng", memoryDir: "/data/groups/eng/memory" }];
    const alice = collaborationCacheKey({
      agentId: "main",
      workspaceDir: "/ws",
      settingsJson: "{}",
      roots,
      identity: { userId: "alice", tenantId: "t1" },
    });
    const bob = collaborationCacheKey({
      agentId: "main",
      workspaceDir: "/ws",
      settingsJson: "{}",
      roots,
      identity: { userId: "bob", tenantId: "t1" },
    });
    expect(alice).not.toBe(bob);
  });
});
