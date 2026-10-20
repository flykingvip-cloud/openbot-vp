import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/config.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
  writeConfigFile: vi.fn(async () => undefined),
}));

const { dataHandlers } = await import("./data.js");

function makeCall(method: keyof typeof dataHandlers, params: Record<string, unknown> = {}) {
  const respond = vi.fn();
  const promise = dataHandlers[method]({
    params,
    respond,
    req: { type: "req" as const, id: "1", method },
    client: null,
    isWebchatConnect: () => false,
    context: {} as never,
  });
  return { respond, promise };
}

describe("dataHandlers managed mode", () => {
  afterEach(() => {
    vi.mocked(loadConfig).mockReturnValue({} as OpenBotConfig);
  });

  it("returns managed mode from data.root.get", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as OpenBotConfig);
    const { promise, respond } = makeCall("data.root.get");
    await promise;
    expect(respond).toHaveBeenCalledWith(true, { mode: "managed" });
  });

  it("rejects data.migration.start on managed gateway", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as OpenBotConfig);
    const { promise, respond } = makeCall("data.migration.start", { targetPath: "/tmp/x" });
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("rejects data.memory.forget on managed gateway", async () => {
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as OpenBotConfig);
    const { promise, respond } = makeCall("data.memory.forget", {
      agentId: "main",
      memoryKey: "note.md",
    });
    await promise;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});

describe("dataHandlers local mode", () => {
  const tmpRoot = path.join(os.tmpdir(), `openbot-data-test-${Date.now()}`);

  afterEach(async () => {
    vi.mocked(loadConfig).mockReturnValue({} as OpenBotConfig);
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns local data root info", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      data: { root: tmpRoot, mode: "local", schemaVersion: 1 },
    } as OpenBotConfig);
    await fs.mkdir(path.join(tmpRoot, "agents"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "agents", "note.txt"), "hello");
    const { promise, respond } = makeCall("data.root.get");
    await promise;
    const payload = respond.mock.calls[0]?.[1] as { mode: string; rootPath?: string };
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(payload.mode).toBe("local");
    expect(payload.rootPath).toBe(path.resolve(tmpRoot));
  });
});
