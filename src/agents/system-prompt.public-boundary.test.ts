import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { renderAgentSystemPrompt } from "../agent-runtime/context/index.js";
import { CHANNEL_IDS } from "../channels/registry.js";

const reads = vi.hoisted(() => ({
  identity: vi.fn(() => {
    throw new Error("render must not read identity files");
  }),
  channels: vi.fn(() => {
    throw new Error("render must not read the plugin registry");
  }),
}));
vi.mock("./identity-file.js", async (original) => ({
  ...(await original<typeof import("./identity-file.js")>()),
  resolveWorkspaceIdentityBootstrapState: reads.identity,
}));
vi.mock("../utils/message-channel.js", async (original) => ({
  ...(await original<typeof import("../utils/message-channel.js")>()),
  listDeliverableMessageChannels: reads.channels,
}));

// Captured from the existing builder before moving its rendering implementation.
const cases = [
  [
    "full_pending",
    "full",
    { identityInitialized: false, userInitialized: false, bootstrapPending: true },
    "d888d6ff0455bf521af9f3522dffb9e894cff43f2af90568f14fdcbd491f9124",
  ],
  [
    "full_initialized",
    "full",
    { identityInitialized: true, userInitialized: true, bootstrapPending: false },
    "98c453f129426f79536a84e515e3ebeaf880757fbe10e6ba26ef1150c0691d62",
  ],
  [
    "minimal",
    "minimal",
    undefined,
    "adfbfbc4f872850c721e57f0e6b18b4479bb2e7451a6bce48919d074d86ccfaa",
  ],
  ["none", "none", undefined, "53ae63fc63e90054f8713923741cb6f0d2d69e69ce645ee8512bdb1c8617714a"],
] as const;

it.each(cases)(
  "preserves captured prompt bytes and source isolation: %s",
  (_name, promptMode, identityBootstrapState, digest) => {
    const text = renderAgentSystemPrompt({
      workspaceDir: "/workspace",
      toolNames: ["read", "exec", "memory_search", "knowledge_search", "message", "zeta", "alpha"],
      toolSummaries: { zeta: "ZETA_TOOL", alpha: "ALPHA_TOOL" },
      skillsPrompt: "SKILL_GUIDANCE",
      extraSystemPrompt: "UNTRUSTED_VIEW",
      userTimezone: "UTC",
      runtimeInfo: {
        agentId: "test-agent",
        host: "fixture",
        os: "fixture",
        arch: "fixture",
        node: "22",
        model: "fixture/model",
      },
      contextFiles: [{ path: "AGENTS.md", content: "CAPTURED_AGENTS" }],
      deliverableMessageChannels: CHANNEL_IDS,
      promptMode,
      identityBootstrapState,
    });
    expect(createHash("sha256").update(text).digest("hex")).toBe(digest);
    expect(reads.identity).not.toHaveBeenCalled();
    expect(reads.channels).not.toHaveBeenCalled();
  },
);
