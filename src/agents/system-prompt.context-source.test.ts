import { beforeEach, expect, it, vi } from "vitest";
import { buildEmbeddedSystemPrompt } from "./pi-embedded-runner/system-prompt.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
const reads = vi.hoisted(() =>
  vi.fn(
    (): { identityInitialized: boolean; userInitialized: boolean; bootstrapPending: boolean } => {
      throw new Error("unexpected identity source read during render");
    },
  ),
);
const channels = vi.hoisted(() => vi.fn(() => ["fixture-channel"]));
vi.mock("../utils/message-channel.js", async (original) => ({
  ...(await original<typeof import("../utils/message-channel.js")>()),
  listDeliverableMessageChannels: channels,
}));
beforeEach(() => {
  reads.mockClear();
  channels.mockClear();
});
vi.mock("./identity-file.js", async (original) => ({
  ...(await original<typeof import("./identity-file.js")>()),
  resolveWorkspaceIdentityBootstrapState: reads,
}));
it("renders captured identity facts without rereading workspace files", () => {
  const input = {
    workspaceDir: "/workspace",
    identityBootstrapState: {
      identityInitialized: true,
      userInitialized: true,
      bootstrapPending: false,
    },
  };
  expect(buildAgentSystemPrompt(input)).not.toContain("## Identity Bootstrap Guard");
  expect(reads).not.toHaveBeenCalled();
  expect(channels).toHaveBeenCalledOnce();
});

it("full embedded prompt captures identity and channel facts exactly once", () => {
  reads.mockReturnValueOnce({
    identityInitialized: true,
    userInitialized: true,
    bootstrapPending: false,
  });
  buildEmbeddedSystemPrompt({
    workspaceDir: "/workspace",
    reasoningTagHint: false,
    runtimeInfo: { host: "test", os: "test", arch: "test", node: "test", model: "test" },
    tools: [],
    modelAliasLines: [],
    userTimezone: "UTC",
  });
  expect(reads).toHaveBeenCalledOnce();
  expect(channels).toHaveBeenCalledOnce();
});

it.each(["minimal", "none"] as const)(
  "does not read omitted identity sources in %s mode",
  (promptMode) => {
    buildEmbeddedSystemPrompt({
      workspaceDir: "/workspace",
      promptMode,
      reasoningTagHint: false,
      runtimeInfo: { host: "test", os: "test", arch: "test", node: "test", model: "test" },
      tools: [],
      modelAliasLines: [],
      userTimezone: "UTC",
    });
    expect(reads).not.toHaveBeenCalled();
  },
);
