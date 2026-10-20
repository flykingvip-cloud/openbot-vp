import { describe, expect, it } from "vitest";
import type { WorkbenchTeamEntry } from "./workbench-home-model.ts";
import { buildWorkbenchNavModel } from "./workbench-nav-model.ts";

function assistantEntry(overrides: Partial<WorkbenchTeamEntry>): WorkbenchTeamEntry {
  return {
    id: overrides.id ?? "a",
    key: overrides.key ?? "a",
    sessionKeys: overrides.sessionKeys ?? [overrides.key ?? "a"],
    kind: "assistant",
    badge: "",
    title: overrides.title ?? "Agent",
    subtitle: "",
    detail: "",
    meta: "",
    updatedAt: null,
    unreadCount: 0,
    activity: "idle" as WorkbenchTeamEntry["activity"],
    saved: false,
    ...overrides,
  };
}

describe("buildWorkbenchNavModel — builtin steward identification (Phase 8.3)", () => {
  it("places the builtin steward entry first with the daibai id + brain icon", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        assistantEntry({ id: "agent-sales", key: "agent-sales", title: "销售助手" }),
        assistantEntry({ id: "main", key: "main", title: "大白管家" }),
      ],
      spaces: [],
      activeSessionKey: "main",
      primaryModule: "assistant",
    });
    expect(model.assistantItems[0]?.id).toBe("daibai");
    expect(model.assistantItems[0]?.iconKey).toBe("brain");
    // Non-steward default agent must NOT be identified as daibai.
    const sales = model.assistantItems.find((item) => item.selectionKey === "agent-sales");
    expect(sales?.id).not.toBe("daibai");
    expect(sales?.iconKey).not.toBe("brain");
  });

  it("does not misidentify a non-main default agent as steward (decision A2)", () => {
    const model = buildWorkbenchNavModel({
      assistants: [assistantEntry({ id: "agent-sales", key: "agent-sales", title: "销售助手" })],
      spaces: [],
      activeSessionKey: "agent-sales",
      primaryModule: "assistant",
      // defaultAgentId is a non-steward agent; steward stays bound to "main".
      sessionDefaults: { defaultAgentId: "agent-sales", mainSessionKey: "main", mainKey: "main" },
    });
    expect(model.assistantItems.every((item) => item.id !== "daibai")).toBe(true);
  });

  it("identifies steward via canonical mainSessionKey alias", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        assistantEntry({
          id: "main",
          key: "agent:main:main",
          sessionKeys: ["agent:main:main"],
          title: "大白管家",
        }),
      ],
      spaces: [],
      activeSessionKey: "agent:main:main",
      primaryModule: "assistant",
      sessionDefaults: {
        defaultAgentId: "main",
        mainKey: "main",
        mainSessionKey: "agent:main:main",
      },
    });
    expect(model.assistantItems[0]?.id).toBe("daibai");
  });
});

function spaceEntry(overrides: Partial<WorkbenchTeamEntry>): WorkbenchTeamEntry {
  return {
    id: overrides.id ?? "space:x",
    key: overrides.key ?? "space:x",
    sessionKeys: overrides.sessionKeys ?? [overrides.key ?? "space:x"],
    kind: "space",
    badge: "",
    title: overrides.title ?? "协作组",
    subtitle: "",
    detail: "",
    meta: "",
    updatedAt: null,
    unreadCount: 0,
    activity: "idle" as WorkbenchTeamEntry["activity"],
    saved: false,
    ...overrides,
  };
}

describe("buildWorkbenchNavModel — steward 1:1 must not activate a collaboration space (Q2)", () => {
  const stewardDefaults = {
    defaultAgentId: "main",
    mainKey: "main",
    mainSessionKey: "agent:main:main",
  };

  it("does NOT flag a space active when the active session is the builtin steward — even if the steward 1:1 key was folded into the space sessionKeys", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        assistantEntry({ id: "main", key: "agent:main:main", sessionKeys: ["agent:main:main"] }),
      ],
      spaces: [
        spaceEntry({
          id: "space:market",
          key: "space:market",
          // Real-world leak: the steward 1:1 key folded into the space's sessionKeys.
          sessionKeys: ["space:market", "agent:main:main"],
          title: "市场研究组",
        }),
      ],
      activeSessionKey: "agent:main:main",
      primaryModule: "assistant",
      sessionDefaults: stewardDefaults,
    });
    const space = model.spaceItems.find((item) => item.selectionKey === "space:market");
    expect(space?.active).toBe(false);
  });

  it("still flags a space active for a genuine (non-steward) group session key", () => {
    const model = buildWorkbenchNavModel({
      assistants: [],
      spaces: [
        spaceEntry({
          id: "space:market",
          key: "space:market",
          sessionKeys: ["space:market", "agent:bot-2:space:market"],
          title: "市场研究组",
        }),
      ],
      activeSessionKey: "space:market",
      primaryModule: "collaboration",
      sessionDefaults: stewardDefaults,
    });
    const space = model.spaceItems.find((item) => item.selectionKey === "space:market");
    expect(space?.active).toBe(true);
  });
});
