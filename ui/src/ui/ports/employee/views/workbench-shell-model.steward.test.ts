import { describe, expect, it } from "vitest";
import type { WorkbenchHomeModel } from "./workbench-home-model.ts";
import { buildWorkbenchShellModel } from "./workbench-shell-model.ts";

const model = {
  activeSession: { title: "会话", subtitle: "", badge: "群聊" },
  signals: { cards: [] },
} as unknown as WorkbenchHomeModel;

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    primaryModule: "assistant" as const,
    teamSelectedKey: "main",
    activeSessionKey: "main",
    connected: true,
    userProfileName: "员工",
    assistantItems: [],
    spaceItems: [],
    model,
    activeSessionUpdatedAt: null,
    ...overrides,
  };
}

describe("buildWorkbenchShellModel — builtin steward badge (Phase 8.3)", () => {
  it("shows the AI badge when the active session is the builtin steward", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({ activeSessionKey: "main", sessionDefaults: { mainSessionKey: "main" } }),
    );
    expect(shell.panelBadge).toBe("AI");
  });

  it("matches steward via canonical mainSessionKey alias", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        activeSessionKey: "agent:main:main",
        sessionDefaults: {
          defaultAgentId: "main",
          mainKey: "main",
          mainSessionKey: "agent:main:main",
        },
      }),
    );
    expect(shell.panelBadge).toBe("AI");
  });

  it("keeps the session badge for a non-steward default agent (decision A2)", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        activeSessionKey: "agent-sales",
        sessionDefaults: { defaultAgentId: "agent-sales", mainKey: "main", mainSessionKey: "main" },
      }),
    );
    expect(shell.panelBadge).toBe("群聊");
  });
});

describe("buildWorkbenchShellModel — stage target follows the explicit selection", () => {
  const daibai = {
    id: "daibai",
    selectionKey: "agent:main:main",
    title: "大白管家",
    module: "assistant" as const,
    active: true,
  };
  // A space that shares the active session key with the steward, so it is also
  // flagged active — this is the seed shape that used to hijack the header.
  const marketSpace = {
    id: "space:market",
    selectionKey: "space:market",
    title: "市场研究组",
    module: "collaboration" as const,
    active: true,
  };

  it("stays in assistant mode when an assistant is selected even if a space is also active", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "assistant",
        teamSelectedKey: "agent:main:main",
        activeSessionKey: "agent:main:main",
        assistantItems: [daibai],
        spaceItems: [marketSpace],
      }),
    );
    // Both the "TO:" header and the sidebar highlight branch on primaryModule,
    // so this single assertion guards the mislabel (selecting 大白管家 must not
    // show "TO: 市场研究组").
    expect(shell.primaryModule).toBe("assistant");
    expect(shell.selectedAssistantItem?.id).toBe("daibai");
  });

  it("stays in collaboration mode when a space is explicitly selected", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "collaboration",
        teamSelectedKey: "space:market",
        activeSessionKey: "agent:main:main",
        assistantItems: [daibai],
        spaceItems: [marketSpace],
      }),
    );
    expect(shell.primaryModule).toBe("collaboration");
    expect(shell.selectedSpaceItem?.id).toBe("space:market");
  });

  it("recovers the steward selection when a stale space key lingers after opening Daibai directly", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "assistant",
        teamSelectedKey: "space:market",
        activeSessionKey: "agent:main:main",
        assistantItems: [daibai],
        spaceItems: [marketSpace],
      }),
    );
    expect(shell.primaryModule).toBe("assistant");
    expect(shell.selectedNavKey).toBe("agent:main:main");
    expect(shell.selectedAssistantItem?.id).toBe("daibai");
  });

  it("Q2 root cause: opening 大白管家 while a STALE 'collaboration' module + an active space linger stays in assistant mode (no 'TO: <group>')", () => {
    // The recurring bug: previously primaryModule==='collaboration' was sticky and
    // resolveSelectedNavKey fell through to the active space, so opening the steward
    // 1:1 rendered "TO: 市场研究组" + group members over the steward thread.
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "collaboration", // stale, persisted from a prior group view
        teamSelectedKey: "agent:main:main", // user just clicked 大白管家
        activeSessionKey: "agent:main:main",
        assistantItems: [daibai],
        spaceItems: [marketSpace], // still flagged active
      }),
    );
    expect(shell.primaryModule).toBe("assistant");
    expect(shell.selectedNavKey).toBe("agent:main:main");
    expect(shell.selectedAssistantItem?.id).toBe("daibai");
  });

  it("keeps collaboration mode for invite-only space deep-links absent from nav", () => {
    // Human invite todos set workbenchTeamSelectedKey=space:<groupId> without switching
    // chat. Invite-only spaces are filtered out of spaceItems (not chat-ready), so the
    // shell must still treat the explicit space: key as collaboration — otherwise the
    // members 待确认 page never opens (falls back to assistant/overview).
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "collaboration",
        teamSelectedKey: "space:grp-hrqb-权变管理专家",
        activeSessionKey: "agent:main:main",
        assistantItems: [daibai],
        spaceItems: [marketSpace],
      }),
    );
    expect(shell.primaryModule).toBe("collaboration");
    expect(shell.selectedNavKey).toBe("space:grp-hrqb-权变管理专家");
    // Must not hijack into another nav space (e.g. 产品测试组) for the wrong approval page.
    expect(shell.selectedSpaceItem).toBeNull();
    expect(shell.selectedAssistantItem).toBeNull();
  });

  it("keeps collaboration mode for invite-only deep-links when no space is active in nav", () => {
    const shell = buildWorkbenchShellModel(
      baseInput({
        primaryModule: "collaboration",
        teamSelectedKey: "space:grp-invite-only",
        activeSessionKey: "agent:main:main",
        assistantItems: [{ ...daibai, active: true }],
        spaceItems: [{ ...marketSpace, active: false }],
      }),
    );
    expect(shell.primaryModule).toBe("collaboration");
    expect(shell.selectedNavKey).toBe("space:grp-invite-only");
  });
});
