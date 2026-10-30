/**
 * Tool securityProfile and continuity authz must hit the same managed fail-closed
 * gate as a full accessContext. Builtin/qmd must not index a managed tenant.
 */
import { describe, expect, it } from "vitest";
import { createMemorySearchTool } from "../agents/tools/memory-tool.js";
import type { OpenBotConfig } from "../config/config.js";
import type { MemoryContinuityAuthzContext } from "./memory-continuity-authz.js";
import { getMemorySearchManager } from "./search-manager.js";

const managedAuthz: MemoryContinuityAuthzContext = {
  tenantId: "tenant-a",
  userId: "alice",
  profile: "managed_enterprise",
  authorizedGroupIds: new Set(["eng"]),
  permissionSource: "governance.tenantId+members.json",
  roots: [
    {
      groupId: "eng",
      memoryDir: "/tmp/should-not-be-read",
      indexPrefix: "collaboration/eng/memory",
      sessionKey: "space:eng",
    },
  ],
};

describe("managed enterprise backend gate", () => {
  it("continuity authz managed_enterprise fails closed on builtin without reading roots", async () => {
    const result = await getMemorySearchManager({
      cfg: { agents: { list: [{ id: "main", default: true }] } } as OpenBotConfig,
      agentId: "main",
      continuityAuthz: managedAuthz,
    });
    expect(result.manager).toBeNull();
    expect(result.error).toBe("managed_backend_not_cogniweave");
  });

  it("memory_search tool securityProfile managed_enterprise does not return snippets", async () => {
    const marker = "MANAGED_SNIPPET_SHOULD_NOT_LEAK";
    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } } as OpenBotConfig,
      agentSessionKey: "agent:main:main",
      authenticatedUserId: "alice",
      securityProfile: "managed_enterprise",
    });
    expect(tool).not.toBeNull();
    const raw = await tool!.execute("call-1", { query: marker });
    const text = JSON.stringify(raw);
    expect(text).not.toContain(marker);
    expect(text).not.toContain("/tmp/should-not-be-read");
    const payload = raw as { details?: { results?: unknown[]; disabled?: boolean } };
    const details = payload.details ?? (raw as { results?: unknown[]; disabled?: boolean });
    const results = details.results ?? [];
    expect(results).toEqual([]);
  });
});
