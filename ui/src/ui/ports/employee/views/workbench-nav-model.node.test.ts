import { describe, expect, it } from "vitest";
import { buildWorkbenchNavModel } from "./workbench-nav-model.ts";

describe("buildWorkbenchNavModel", () => {
  it("hides assistant rows whose title is only a UUID", () => {
    const uuid = "11f7a389-2e7a-4767-ad35-e617d33f3b93";
    const model = buildWorkbenchNavModel({
      assistants: [
        {
          id: "agent:market:main",
          key: "agent:market:main",
          sessionKeys: ["agent:market:main"],
          kind: "assistant",
          badge: "市",
          title: "市场助手",
          subtitle: "Secondary persona",
          detail: "detail",
          meta: "meta",
          updatedAt: 2,
          unreadCount: 0,
          activity: "active",
          saved: false,
        },
        {
          id: `agent:${uuid}:main`,
          key: `agent:${uuid}:main`,
          sessionKeys: [`agent:${uuid}:main`],
          kind: "assistant",
          badge: "U",
          title: uuid,
          subtitle: "Secondary persona",
          detail: "detail",
          meta: "meta",
          updatedAt: 1,
          unreadCount: 0,
          activity: "idle",
          saved: false,
        },
      ],
      spaces: [],
      activeSessionKey: "agent:market:main",
      primaryModule: "assistant",
    });

    expect(model.assistantItems.map((entry) => entry.title)).toEqual(["市场助手"]);
  });

  it("prefers bound collaboration history sessions over space aliases", () => {
    const model = buildWorkbenchNavModel({
      assistants: [],
      spaces: [
        {
          id: "alpha",
          key: "space:alpha",
          sessionKeys: ["agent:main:main:space:alpha", "agent:main:space:alpha", "space:alpha"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 1,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      activeSessionKey: "space:alpha",
      primaryModule: "collaboration",
    });

    expect(model.spaceItems[0]?.selectionKey).toBe("space:alpha");
    expect(model.spaceItems[0]?.sourceKey).toBe("agent:main:main:space:alpha");
  });

  it("falls back to the latest assistant history session when the canonical main session is missing", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        {
          id: "agent:analyst:main",
          key: "agent:analyst:main",
          sessionKeys: [
            "agent:analyst:telegram:direct:alice",
            "agent:analyst:telegram:group:ops-room",
          ],
          kind: "assistant",
          badge: "DA",
          title: "Data Analyst",
          subtitle: "Secondary persona",
          detail: "detail",
          meta: "meta",
          updatedAt: 10,
          unreadCount: 0,
          activity: "active",
          saved: false,
        },
      ],
      spaces: [],
      activeSessionKey: "agent:analyst:telegram:direct:alice",
      primaryModule: "assistant",
    });

    expect(model.assistantItems[0]?.selectionKey).toBe("agent:analyst:main");
    expect(model.assistantItems[0]?.sourceKey).toBe("agent:analyst:telegram:direct:alice");
  });

  it("prefers non-collaboration assistant history before space-scoped sessions", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        {
          id: "agent:skill:main",
          key: "agent:skill:main",
          sessionKeys: [
            "agent:skill:main:space:space-aegis",
            "agent:skill:wechat:direct:upbeyond",
            "space:space-aegis",
          ],
          kind: "assistant",
          badge: "技",
          title: "Skill 孵化",
          subtitle: "Secondary persona",
          detail: "detail",
          meta: "meta",
          updatedAt: 10,
          unreadCount: 0,
          activity: "active",
          saved: false,
        },
      ],
      spaces: [],
      activeSessionKey: "agent:skill:wechat:direct:upbeyond",
      primaryModule: "assistant",
    });

    expect(model.assistantItems[0]?.selectionKey).toBe("agent:skill:main");
    expect(model.assistantItems[0]?.sourceKey).toBe("agent:skill:wechat:direct:upbeyond");
  });

  it("ignores cron sessions when picking the assistant source session", () => {
    const model = buildWorkbenchNavModel({
      assistants: [
        {
          id: "agent:bot:main",
          key: "agent:bot:main",
          sessionKeys: ["agent:bot:cron:job-1", "agent:bot:main:space:space-aegis"],
          kind: "assistant",
          badge: "高",
          title: "高级秘书",
          subtitle: "Secondary persona",
          detail: "detail",
          meta: "meta",
          updatedAt: 10,
          unreadCount: 0,
          activity: "active",
          saved: false,
        },
      ],
      spaces: [],
      activeSessionKey: "agent:bot:main:space:space-aegis",
      primaryModule: "assistant",
    });

    expect(model.assistantItems[0]?.selectionKey).toBe("agent:bot:main");
    expect(model.assistantItems[0]?.sourceKey).toBe("agent:bot:main:space:space-aegis");
  });

  it("orders module items as tasks → knowledge → settings and marks the active module", () => {
    const model = buildWorkbenchNavModel({
      assistants: [],
      spaces: [],
      activeSessionKey: "",
      primaryModule: "tasks",
    });

    expect(model.moduleItems.map((item) => item.id)).toEqual(["tasks", "knowledge", "settings"]);
    const tasksItem = model.moduleItems.find((item) => item.id === "tasks");
    expect(tasksItem?.active).toBe(true);
    expect(model.moduleItems.find((item) => item.id === "knowledge")?.active).toBe(false);
  });
});
