import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMcpServerToolsForDiscovery } from "./mcp-remote-tools-list.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

const spawnSyncMock = vi.mocked(spawnSync);

describe("listMcpServerToolsForDiscovery", () => {
  afterEach(() => {
    spawnSyncMock.mockReset();
  });

  it("lists tools without issuing a sample call", () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: JSON.stringify({ tools: [{ name: "search" }, { name: "fetch_repo" }] }),
      stderr: "",
      pid: 1,
      output: ["", "", ""],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);
    const result = listMcpServerToolsForDiscovery({ serverName: "github" });
    expect(result.ok).toBe(true);
    expect(result.toolNames).toEqual(["search", "fetch_repo"]);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const args = spawnSyncMock.mock.calls[0]?.[1] ?? [];
    expect(args).toContain("list");
    expect(args).toContain("github");
    expect(args).not.toContain("call");
  });

  it("returns failure on non-zero exit / timeout-style stderr", () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "timeout",
      pid: 1,
      output: ["", "", ""],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);
    const result = listMcpServerToolsForDiscovery({ serverName: "github" });
    expect(result.ok).toBe(false);
    expect(result.toolNames).toEqual([]);
    expect(result.failureReason).toContain("timeout");
  });
});
