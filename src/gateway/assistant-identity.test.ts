import { describe, expect, it } from "vitest";
import { BUILTIN_STEWARD_NAME } from "../agents/builtin-steward/identity.js";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";

describe("resolveAssistantIdentity steward name fallback", () => {
  it("falls back to the steward name for the builtin steward agent (main)", () => {
    // Empty cfg → default agent resolves to "main" = builtin steward.
    const cfg: OpenBotConfig = {};
    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).name).toBe(BUILTIN_STEWARD_NAME);
    expect(resolveAssistantIdentity({ cfg, agentId: "main", workspaceDir: "" }).name).toBe(
      BUILTIN_STEWARD_NAME,
    );
  });

  it("keeps the global default name for non-steward agents (no global pollution)", () => {
    const cfg: OpenBotConfig = {
      agents: { list: [{ id: "main", default: true }, { id: "agent-sales" }] },
    };
    expect(resolveAssistantIdentity({ cfg, agentId: "agent-sales", workspaceDir: "" }).name).toBe(
      DEFAULT_ASSISTANT_IDENTITY.name,
    );
  });

  it("still honors explicitly configured assistant name over steward fallback", () => {
    const cfg: OpenBotConfig = { ui: { assistant: { name: "Nova" } } };
    expect(resolveAssistantIdentity({ cfg, agentId: "main", workspaceDir: "" }).name).toBe("Nova");
  });
});

describe("resolveAssistantIdentity avatar normalization", () => {
  it("drops sentence-like avatar placeholders", () => {
    const cfg: OpenBotConfig = {
      ui: {
        assistant: {
          avatar: "workspace-relative path, http(s) URL, or data URI",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe(
      DEFAULT_ASSISTANT_IDENTITY.avatar,
    );
  });

  it("keeps short text avatars", () => {
    const cfg: OpenBotConfig = {
      ui: {
        assistant: {
          avatar: "PS",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("PS");
  });

  it("keeps path avatars", () => {
    const cfg: OpenBotConfig = {
      ui: {
        assistant: {
          avatar: "avatars/openclaw.png",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("avatars/openclaw.png");
  });
});

describe("resolveAssistantIdentity agents.list name fallback (DESKTOP_COMPUTER_STRIP_DISPLAY_NAME_M1)", () => {
  it("uses agents.list[].name when identity.name / file name are missing", () => {
    const cfg: OpenBotConfig = {
      agents: {
        list: [
          { id: "main", default: true },
          { id: "bot-2", name: "市场助手" },
        ],
      },
    };
    expect(resolveAssistantIdentity({ cfg, agentId: "bot-2", workspaceDir: "" }).name).toBe(
      "市场助手",
    );
  });

  it("keeps identity.name over agents.list[].name (Skill孵化 unchanged)", () => {
    const cfg: OpenBotConfig = {
      agents: {
        list: [
          { id: "main", default: true },
          {
            id: "skill-hatch",
            name: "roster-should-not-win",
            identity: { name: "Skill孵化" },
          },
        ],
      },
    };
    expect(resolveAssistantIdentity({ cfg, agentId: "skill-hatch", workspaceDir: "" }).name).toBe(
      "Skill孵化",
    );
  });

  it("still uses DEFAULT only when neither identity nor list name is set", () => {
    const cfg: OpenBotConfig = {
      agents: { list: [{ id: "main", default: true }, { id: "agent-sales" }] },
    };
    expect(resolveAssistantIdentity({ cfg, agentId: "agent-sales", workspaceDir: "" }).name).toBe(
      DEFAULT_ASSISTANT_IDENTITY.name,
    );
  });
});
