import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMcporterListSchemaOutput, probeMcpAssetBindingHealth } from "./mcp-health-probe.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

const spawnSyncMock = vi.mocked(spawnSync);

describe("parseMcporterListSchemaOutput", () => {
  it("reads tool names from JSON schema output", () => {
    const stdout = JSON.stringify({
      tools: [{ name: "search" }, { name: "fetch_repo" }],
    });
    expect(parseMcporterListSchemaOutput(stdout)).toEqual(["search", "fetch_repo"]);
  });

  it("returns empty for blank stdout", () => {
    expect(parseMcporterListSchemaOutput("   ")).toEqual([]);
  });
});

describe("probeMcpAssetBindingHealth", () => {
  afterEach(() => {
    spawnSyncMock.mockReset();
  });

  it("skips subprocess when disabled", () => {
    const result = probeMcpAssetBindingHealth({
      binding: { serverName: "github", transport: "stdio", command: "node" },
      enabled: false,
    });
    expect(result.skipped).toBe(true);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("fails when mcporter list exits non-zero", () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "connection refused",
      pid: 1,
      output: ["", "", ""],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);
    const result = probeMcpAssetBindingHealth({
      binding: { serverName: "github", transport: "stdio", command: "node" },
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("connection refused");
  });

  it("lists tools and runs sample call on allowlisted tool", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ tools: [{ name: "search" }, { name: "ping" }] }),
        stderr: "",
        pid: 1,
        output: ["", "", ""],
        signal: null,
        error: undefined,
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        status: 0,
        stdout: '{"ok":true}',
        stderr: "",
        pid: 2,
        output: ["", "", ""],
        signal: null,
        error: undefined,
      } as ReturnType<typeof spawnSync>);
    const result = probeMcpAssetBindingHealth({
      binding: {
        serverName: "github",
        transport: "stdio",
        command: "node",
        toolAllowlist: ["search"],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.listedTools).toBe(2);
    expect(result.sampleCall).toEqual(expect.objectContaining({ tool: "search", ok: true }));
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    const callArgs = spawnSyncMock.mock.calls[1]?.[1] ?? [];
    expect(callArgs).toContain("github.search");
  });

  it("surfaces sample call KeyError-style failures", () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ tools: [{ name: "send_message" }] }),
        stderr: "",
        pid: 1,
        output: ["", "", ""],
        signal: null,
        error: undefined,
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "KeyError: 'message'",
        pid: 2,
        output: ["", "", ""],
        signal: null,
        error: undefined,
      } as ReturnType<typeof spawnSync>);
    const result = probeMcpAssetBindingHealth({
      binding: {
        serverName: "co-mcp",
        transport: "stdio",
        command: "node",
        toolAllowlist: ["send_message"],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("KeyError");
    expect(result.sampleCall?.ok).toBe(false);
  });
});
