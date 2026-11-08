import { expect, it, vi } from "vitest";
import { buildEmbeddedSystemPrompt } from "./pi-embedded-runner/system-prompt.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
const reads = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("unexpected identity source read during render");
  }),
);
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
