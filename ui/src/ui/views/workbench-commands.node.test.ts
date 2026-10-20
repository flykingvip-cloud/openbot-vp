import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkbenchSidebarItem,
  WorkbenchTeamEntry,
} from "../ports/employee/views/workbench-home-model.ts";

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function makeSidebarItem(
  partial: Partial<WorkbenchSidebarItem> & Pick<WorkbenchSidebarItem, "key" | "title">,
): WorkbenchSidebarItem {
  return {
    key: partial.key,
    sessionKeys: partial.sessionKeys ?? [partial.key],
    title: partial.title,
    subtitle: partial.subtitle ?? "subtitle",
    preview: partial.preview ?? "preview",
    badge: partial.badge ?? "AA",
    meta: partial.meta ?? "meta",
    updatedAt: partial.updatedAt ?? Date.now(),
    unreadCount: partial.unreadCount ?? 0,
    activity: partial.activity ?? "active",
    kind: partial.kind ?? "agent",
  };
}

function makeTeamEntry(
  partial: Partial<WorkbenchTeamEntry> & Pick<WorkbenchTeamEntry, "key" | "title" | "kind">,
): WorkbenchTeamEntry {
  return {
    id: partial.id ?? partial.key,
    key: partial.key,
    sessionKeys: partial.sessionKeys ?? [partial.key],
    kind: partial.kind,
    badge: partial.badge ?? "AA",
    title: partial.title,
    subtitle: partial.subtitle ?? "subtitle",
    detail: partial.detail ?? "detail",
    meta: partial.meta ?? "meta",
    updatedAt: partial.updatedAt ?? Date.now(),
    unreadCount: partial.unreadCount ?? 0,
    activity: partial.activity ?? "active",
    saved: partial.saved ?? false,
  };
}

describe("workbench command registry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds stable remote sections and command ids", async () => {
    const { buildWorkbenchCommandSections, findWorkbenchCommand } =
      await import("./workbench-commands.ts");

    const sections = buildWorkbenchCommandSections({
      agents: [
        makeSidebarItem({ key: "main", title: "Main", kind: "agent", meta: "main meta" }),
        makeSidebarItem({
          key: "agent:analyst:main",
          title: "Analyst",
          kind: "agent",
          meta: "analyst meta",
        }),
      ],
      contacts: [
        makeSidebarItem({
          key: "agent:main:telegram:direct:alice",
          title: "Alice",
          kind: "contact",
        }),
      ],
      groups: [
        makeSidebarItem({
          key: "agent:main:telegram:group:product",
          title: "Product",
          kind: "group",
        }),
      ],
      teamAssistants: [
        makeTeamEntry({ key: "agent:analyst:main", title: "Insight Desk", kind: "assistant" }),
      ],
      teamMembers: [
        makeTeamEntry({
          key: "agent:main:telegram:direct:alice",
          title: "Alice PM",
          kind: "member",
        }),
      ],
      teamSpaces: [
        makeTeamEntry({
          key: "agent:main:telegram:group:product",
          title: "Product Room",
          kind: "space",
        }),
      ],
    });

    expect(sections.map((section) => section.id)).toEqual([
      "team",
      "recommendations",
      "actions",
      "assistants",
    ]);
    expect(findWorkbenchCommand(sections, "quick-chat")).toMatchObject({
      actionId: "openFullChat",
      shortcut: "C",
    });
    expect(findWorkbenchCommand(sections, "recommend-coach")).toMatchObject({
      actionId: "openDashboardCoach",
    });
    expect(findWorkbenchCommand(sections, "team-assistant:agent:analyst:main")).toMatchObject({
      actionId: "selectSession",
      sessionKey: "agent:analyst:main",
    });
  });

  it("uses console-oriented wording for remote assistant and channel actions", async () => {
    const { buildWorkbenchCommandSections, findWorkbenchCommand } =
      await import("./workbench-commands.ts");

    const sections = buildWorkbenchCommandSections({
      agents: [],
      contacts: [],
      groups: [],
      teamAssistants: [],
      teamMembers: [],
      teamSpaces: [],
    });

    expect(findWorkbenchCommand(sections, "quick-agents")).toMatchObject({
      title: "Assistant settings",
      subtitle: "Use the console to manage assistants, identities, and tool access.",
      actionId: "openAssistantSettings",
    });
    expect(findWorkbenchCommand(sections, "quick-channels")).toMatchObject({
      title: "Channel settings",
      subtitle: "Use the console to inspect linked messaging surfaces and routing health.",
      actionId: "openChannelSettings",
    });
  });
});
