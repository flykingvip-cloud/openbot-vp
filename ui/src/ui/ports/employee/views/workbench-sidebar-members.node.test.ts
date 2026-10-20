// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { selectCollaborationSpaceEntry } from "./workbench-sidebar-members.ts";

describe("workbench sidebar members", () => {
  it("switches collaboration entries into chat mode and loads members", () => {
    const onPrimaryModuleChange = vi.fn();
    const onTeamSelectedKeyChange = vi.fn();
    const onSelectSession = vi.fn();
    const onGroupProfileViewChange = vi.fn();
    const onLoadGroupMembers = vi.fn(async () => undefined);

    selectCollaborationSpaceEntry(
      {
        id: "space:product-rd",
        selectionKey: "space:product-rd",
        title: "产品研发小组",
        rawTitle: "产品研发小组",
        iconKey: "users",
        module: "collaboration",
        tone: "teal",
        sourceKey: "agent:main:wechat:group:product-rd",
        directoryChannelId: "wechat",
        directoryGroupId: "product-rd",
      },
      {
        onPrimaryModuleChange,
        onTeamSelectedKeyChange,
        onSelectSession,
        onGroupProfileViewChange,
        onLoadGroupMembers,
      },
    );

    expect(onPrimaryModuleChange).toHaveBeenCalledWith("collaboration");
    expect(onTeamSelectedKeyChange).toHaveBeenCalledWith("space:product-rd");
    expect(onSelectSession).toHaveBeenCalledWith("space:product-rd");
    expect(onGroupProfileViewChange).toHaveBeenCalledWith("chat");
    expect(onLoadGroupMembers).toHaveBeenCalledWith({
      selectionKey: "space:product-rd",
      channelId: "wechat",
      title: "产品研发小组",
      fallbackGroupId: "product-rd",
    });
  });
});
