import { describe, expect, it, vi } from "vitest";
import "../test-helpers/fast-coding-tools.js";
import * as executionChainProvenance from "../../infra/execution-chain-provenance.js";
import type { ToolSelectionProvenance } from "../../infra/execution-chain-provenance.js";
import { createOpenClawCodingTools } from "../pi-tools.js";
import type { SandboxDockerConfig } from "../sandbox.js";
import { DEFAULT_TOOL_ALLOW, DEFAULT_TOOL_DENY } from "./constants.js";
import type { SandboxFsBridge } from "./fs-bridge.js";

const sandboxFsBridgeStub: SandboxFsBridge = {
  resolvePath: () => ({
    hostPath: "/tmp/sandbox",
    relativePath: "",
    containerPath: "/workspace",
  }),
  readFile: async () => Buffer.from(""),
  writeFile: async () => {},
  mkdirp: async () => {},
  remove: async () => {},
  rename: async () => {},
  stat: async () => null,
};

const docker = {
  image: "test-image",
  containerPrefix: "test-",
  workdir: "/workspace",
  readOnlyRoot: true,
  tmpfs: [],
  network: "none",
  capDrop: [],
} satisfies SandboxDockerConfig;

function sandboxWithAccountComputer(accountComputerBrowser: boolean) {
  return {
    enabled: true,
    sessionKey: "agent:bot:main",
    workspaceDir: "/tmp/sandbox",
    agentWorkspaceDir: "/tmp/sandbox",
    workspaceAccess: "rw" as const,
    containerName: "aw-exec-lease",
    containerWorkdir: "/account/workspace",
    docker,
    tools: {
      allow: [...DEFAULT_TOOL_ALLOW],
      deny: [...DEFAULT_TOOL_DENY],
    },
    fsBridge: sandboxFsBridgeStub,
    browserAllowHostControl: false,
    ...(accountComputerBrowser
      ? {
          accountComputerBrowser: true as const,
          browser: {
            bridgeUrl: "http://127.0.0.1:18792",
            containerName: "aw-browser-lease",
          },
        }
      : {}),
  };
}

describe("account computer browser tool exposure", () => {
  it("exposes browser on a coding profile when the Account Computer bridge is attached", () => {
    const names = createOpenClawCodingTools({
      config: { tools: { profile: "coding" } },
      sessionKey: "agent:bot:main",
      workspaceDir: "/tmp/sandbox",
      sandbox: sandboxWithAccountComputer(true),
    }).map((tool) => tool.name);
    expect(names).toContain("browser");
    expect(names).toContain("secure_form");
    const browser = createOpenClawCodingTools({
      config: { tools: { profile: "coding" } },
      sessionKey: "agent:bot:main",
      workspaceDir: "/tmp/sandbox",
      sandbox: sandboxWithAccountComputer(true),
    }).find((tool) => tool.name === "browser");
    expect(browser?.description).toContain("Account Computer");
  });

  it("keeps browser hidden when the bridge is absent or an operator deny lists it", () => {
    const hidden = createOpenClawCodingTools({
      config: { tools: { profile: "coding" } },
      sessionKey: "agent:bot:main",
      workspaceDir: "/tmp/sandbox",
      sandbox: sandboxWithAccountComputer(false),
    }).map((tool) => tool.name);
    expect(hidden).not.toContain("browser");

    const denied = createOpenClawCodingTools({
      config: { tools: { profile: "coding", deny: ["browser"] } },
      sessionKey: "agent:bot:main",
      workspaceDir: "/tmp/sandbox",
      sandbox: sandboxWithAccountComputer(true),
    }).map((tool) => tool.name);
    expect(denied).not.toContain("browser");
    expect(denied).toContain("secure_form");
  });

  it("records the model-visible tool list after a public-fetch strip", async () => {
    const spy = vi
      .spyOn(executionChainProvenance, "emitExecutionChainProvenance")
      .mockImplementation(() => {});
    try {
      const tools = createOpenClawCodingTools({
        config: { tools: { profile: "coding" } },
        sessionKey: "agent:bot:main",
        workspaceDir: "/tmp/sandbox",
        sandbox: sandboxWithAccountComputer(true),
        omitToolNames: ["browser"],
      });
      expect(tools.map((tool) => tool.name)).not.toContain("browser");
      const status = tools.find((tool) => tool.name === "session_status");
      expect(status?.execute).toBeTypeOf("function");
      await status?.execute?.("call-1", {}).catch(() => {});
      const record = spy.mock.calls
        .map((call) => call[0])
        .find(
          (entry): entry is ToolSelectionProvenance =>
            entry.kind === "tool_selection" && entry.selected_capability === "session_status",
        );
      expect(record?.policy_filtered_capabilities).toEqual(tools.map((tool) => tool.name));
      expect(record?.policy_filtered_capabilities).not.toContain("browser");
    } finally {
      spy.mockRestore();
    }
  });
});
