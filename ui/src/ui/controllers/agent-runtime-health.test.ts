import { describe, expect, it, vi } from "vitest";
import { indexAgentRuntimeHealth, loadAgentRuntimeHealth } from "./agent-runtime-health.ts";

describe("indexAgentRuntimeHealth", () => {
  it("indexes valid reports by agentId", () => {
    const map = indexAgentRuntimeHealth([
      { agentId: "main", health: "online" },
      { agentId: "sales-bot", health: "degraded" },
      { agentId: "ghost", health: "unconfigured" },
    ]);
    expect(map.get("main")).toBe("online");
    expect(map.get("sales-bot")).toBe("degraded");
    expect(map.get("ghost")).toBe("unconfigured");
    expect(map.size).toBe(3);
  });

  it("ignores entries with missing agentId or unknown health", () => {
    const map = indexAgentRuntimeHealth([
      { agentId: "", health: "online" },
      { agentId: "x", health: "bogus" },
      { health: "online" },
      { agentId: "ok", health: "offline" },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("ok")).toBe("offline");
  });

  it("returns an empty map for non-array input", () => {
    expect(indexAgentRuntimeHealth(undefined).size).toBe(0);
    expect(indexAgentRuntimeHealth(null).size).toBe(0);
    expect(indexAgentRuntimeHealth({}).size).toBe(0);
  });
});

describe("loadAgentRuntimeHealth", () => {
  it("requests agents.runtime-health and indexes the reports", async () => {
    const request = vi.fn(async () => ({
      reports: [
        { agentId: "main", health: "online" },
        { agentId: "sales-bot", health: "offline" },
      ],
    }));
    const map = await loadAgentRuntimeHealth({ request });
    expect(request).toHaveBeenCalledWith("agents.runtime-health", {});
    expect(map.get("main")).toBe("online");
    expect(map.get("sales-bot")).toBe("offline");
  });

  it("returns an empty map when the response has no reports", async () => {
    const request = vi.fn(async () => ({}));
    const map = await loadAgentRuntimeHealth({ request });
    expect(map.size).toBe(0);
  });
});
