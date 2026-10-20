import { describe, expect, it } from "vitest";
import { buildConversationSessionKey } from "../conversations/session-runtime.js";
import { buildBotGroupSessionKey } from "../gateway/collaboration-learning/shared.js";
import {
  canonicalizeWorkbenchChatSessionKey,
  isCollaborationGroupChatSessionKey,
  isImportedAgentSessionKey,
  isLeftoverBotSpaceSessionKey,
  isOrganizationAgentSessionKey,
  isRedundantRobotAliasSessionKey,
  isWecomGroupSessionKey,
  toOrganizationAgentSessionKey,
} from "./session-key-utils.js";

describe("canonicalizeWorkbenchChatSessionKey", () => {
  it("collapses every group alias onto space:<groupId>", () => {
    expect(canonicalizeWorkbenchChatSessionKey("space:grp-1")).toBe("space:grp-1");
    expect(canonicalizeWorkbenchChatSessionKey("space:space:grp-1")).toBe("space:grp-1");
    expect(canonicalizeWorkbenchChatSessionKey("agent:main:space:grp-1")).toBe("space:grp-1");
    expect(canonicalizeWorkbenchChatSessionKey("agent:panda:main:space:grp-1")).toBe("space:grp-1");
    expect(canonicalizeWorkbenchChatSessionKey("agent:main:main:space:grp-1")).toBe("space:grp-1");
  });

  it("collapses extra robot aliases onto agent:<id>:main", () => {
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:main")).toBe("agent:bot-2:main");
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:imported:workbuddy:x")).toBe(
      "agent:bot-2:imported:workbuddy:x",
    );
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:telegram:direct:1")).toBe(
      "agent:bot-2:main",
    );
  });

  it("leaves cron, subagent, acp, employee steward, and org inboxes on their own files", () => {
    expect(canonicalizeWorkbenchChatSessionKey("agent:main:cron:job:run:1")).toBe(
      "agent:main:cron:job:run:1",
    );
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:subagent:child")).toBe(
      "agent:bot-2:subagent:child",
    );
    expect(canonicalizeWorkbenchChatSessionKey("agent:main:employee:user-1")).toBe(
      "agent:main:employee:user-1",
    );
    expect(canonicalizeWorkbenchChatSessionKey("agent:bot-2:org:upbeyond")).toBe(
      "agent:bot-2:org:upbeyond",
    );
    expect(toOrganizationAgentSessionKey({ agentId: "bot-2", organizationId: "upbeyond" })).toBe(
      "agent:bot-2:org:upbeyond",
    );
    expect(isOrganizationAgentSessionKey("agent:bot-2:org:upbeyond")).toBe(true);
    expect(isOrganizationAgentSessionKey("agent:bot-2:main:space:upbeyond")).toBe(false);
    expect(isLeftoverBotSpaceSessionKey("agent:bot-2:main:space:upbeyond")).toBe(true);
    expect(isLeftoverBotSpaceSessionKey("agent:panda:main:space:grp-1")).toBe(true);
    expect(isLeftoverBotSpaceSessionKey("space:grp-1")).toBe(false);
    expect(isLeftoverBotSpaceSessionKey("agent:bot-2:org:upbeyond")).toBe(false);
    expect(isLeftoverBotSpaceSessionKey("agent:bot-2:main")).toBe(false);
  });

  it("never mints bot-scoped leftover keys from buildBotGroupSessionKey", () => {
    expect(buildBotGroupSessionKey("panda", "grp-1")).toBe("space:grp-1");
    expect(buildBotGroupSessionKey("aegis", "space:grp-1")).toBe("space:grp-1");
  });

  it("nests group conversation children under space:<groupId>, not a bot mirror", () => {
    expect(
      buildConversationSessionKey({
        surfaceType: "COLLABORATION_GROUP",
        agentId: "panda",
        groupId: "grp-1",
        conversationId: "conv_abc",
      }),
    ).toBe("space:grp-1:conversation:conv_abc");
  });

  it("marks imported workbuddy and wecom group keys as leftover aliases", () => {
    expect(isImportedAgentSessionKey("agent:bot-skill:imported:workbuddy:abc")).toBe(true);
    expect(isWecomGroupSessionKey("agent:bot-2:wecom:group:daniel")).toBe(true);
    expect(isRedundantRobotAliasSessionKey("agent:bot-2:main")).toBe(false);
  });
});

describe("isCollaborationGroupChatSessionKey", () => {
  it("detects space lanes and rejects 1:1 bot chats", () => {
    expect(isCollaborationGroupChatSessionKey("space:grp-1")).toBe(true);
    expect(isCollaborationGroupChatSessionKey("agent:panda:main:space:grp-1")).toBe(true);
    expect(isCollaborationGroupChatSessionKey("agent:panda:main")).toBe(false);
    expect(isCollaborationGroupChatSessionKey("agent:main:main")).toBe(false);
    expect(isCollaborationGroupChatSessionKey(null)).toBe(false);
  });
});
