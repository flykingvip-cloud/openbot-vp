import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConfigMock, isNodeCommandAllowedMock, resolveNodeCommandAllowlistMock } = vi.hoisted(
  () => ({
    loadConfigMock: vi.fn(),
    isNodeCommandAllowedMock: vi.fn(),
    resolveNodeCommandAllowlistMock: vi.fn(),
  }),
);

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../node-command-policy.js", () => ({
  isNodeCommandAllowed: isNodeCommandAllowedMock,
  resolveNodeCommandAllowlist: resolveNodeCommandAllowlistMock,
}));

import { browserHandlers } from "./browser.js";

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createContext() {
  const invoke = vi.fn(async () => ({
    ok: true,
    payload: {
      result: { ok: true },
    },
  }));
  const listConnected = vi.fn(() => [
    {
      nodeId: "node-1",
      caps: ["browser"],
      commands: ["browser.proxy"],
      platform: "linux",
    },
  ]);
  return {
    invoke,
    listConnected,
  };
}

async function runBrowserRequest(params: Record<string, unknown>) {
  const respond = vi.fn();
  const nodeRegistry = createContext();
  await browserHandlers["browser.request"]({
    params,
    respond: respond as never,
    context: { nodeRegistry } as never,
    client: null,
    req: { type: "req", id: "req-1", method: "browser.request" },
    isWebchatConnect: () => false,
  });
  return { respond, nodeRegistry };
}

describe("browser.request profile selection", () => {
  beforeEach(() => {
    loadConfigMock.mockReturnValue({
      gateway: { nodes: { browser: { mode: "auto" } } },
    });
    resolveNodeCommandAllowlistMock.mockReturnValue([]);
    isNodeCommandAllowedMock.mockReturnValue({ ok: true });
  });

  it("uses profile from request body when query profile is missing", async () => {
    const { respond, nodeRegistry } = await runBrowserRequest({
      method: "POST",
      path: "/act",
      body: { profile: "work", request: { action: "click", ref: "btn1" } },
    });

    expect(nodeRegistry.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "browser.proxy",
        params: expect.objectContaining({
          profile: "work",
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
  });

  it("rejects body profile and profilePath under managed multitenant", async () => {
    const prevMode = process.env.OPENBOT_DATA_MODE;
    const prevMulti = process.env.OPENBOT_MULTITENANT;
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    loadConfigMock.mockReturnValue({
      data: { mode: "managed" },
      gateway: { nodes: { browser: { mode: "auto" } } },
    });
    try {
      const withProfile = await runBrowserRequest({
        method: "POST",
        path: "/act",
        body: { profile: "work", request: { action: "click", ref: "btn1" } },
      });
      expect(withProfile.nodeRegistry.invoke).not.toHaveBeenCalled();
      expect((withProfile.respond.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(false);

      const withPath = await runBrowserRequest({
        method: "POST",
        path: "/act",
        body: { profilePath: "/tmp/other-user-profile", request: { action: "click", ref: "btn1" } },
      });
      expect(withPath.nodeRegistry.invoke).not.toHaveBeenCalled();
      expect((withPath.respond.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(false);
    } finally {
      if (prevMode === undefined) {
        delete process.env.OPENBOT_DATA_MODE;
      } else {
        process.env.OPENBOT_DATA_MODE = prevMode;
      }
      if (prevMulti === undefined) {
        delete process.env.OPENBOT_MULTITENANT;
      } else {
        process.env.OPENBOT_MULTITENANT = prevMulti;
      }
    }
  });

  it("prefers query profile over body profile when both are present", async () => {
    const { nodeRegistry } = await runBrowserRequest({
      method: "POST",
      path: "/act",
      query: { profile: "chrome" },
      body: { profile: "work", request: { action: "click", ref: "btn1" } },
    });

    expect(nodeRegistry.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          profile: "chrome",
        }),
      }),
    );
  });
});
