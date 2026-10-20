import { describe, expect, test } from "vitest";
import {
  DEFAULT_CHAT_CONTEXT_SCOPE,
  applyConversationOnlyScope,
  applyDeepSearchToggle,
  buildContextScopeCatalogTree,
  compactChatContextSources,
  filterContextScopeCatalog,
  filterContextScopeCatalogTree,
  parseContextScopeCatalog,
  parseConsumeReceiptsFromAgentEvent,
  applyConsumeReceipts,
  resolveContextSourceCheckState,
  resolveGroupIdFromSessionKey,
  summarizeContextReadingSources,
  toChatSendContextScope,
  toggleChatContextSource,
} from "./context-scope.ts";

const CATALOG = parseContextScopeCatalog([
  { type: "knowledge", id: "kb-1", label: "产品资料", visibility: "private" },
  { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-1", visibility: "private" },
  { type: "folder", id: "lfb-design", label: "设计稿", parentId: "kb-1", visibility: "private" },
  { type: "knowledge", id: "kb-team", label: "团队制度", visibility: "team", hasConflict: true },
  { type: "api", id: "src-crm", label: "CRM", parentId: "kb-team" },
]);

describe("chat context scope payload", () => {
  test("omits default auto turn so the server keeps CSC auto", () => {
    expect(toChatSendContextScope(DEFAULT_CHAT_CONTEXT_SCOPE, "main")).toBeUndefined();
  });

  test("maps conversation to minimal and group to focused group source", () => {
    expect(
      toChatSendContextScope({ ...DEFAULT_CHAT_CONTEXT_SCOPE, preset: "conversation" }, "main"),
    ).toEqual({ mode: "minimal", lifetime: "turn" });
    expect(
      toChatSendContextScope(
        { ...DEFAULT_CHAT_CONTEXT_SCOPE, preset: "group", lifetime: "session" },
        "agent:main:space:alpha",
      ),
    ).toEqual({
      mode: "focused",
      lifetime: "session",
      sources: [{ type: "group", id: "alpha" }],
    });
  });

  test("reads group id from space aliases", () => {
    expect(resolveGroupIdFromSessionKey("space:alpha")).toBe("alpha");
    expect(resolveGroupIdFromSessionKey("agent:bot-2:main:space:alpha")).toBe("alpha");
    expect(resolveGroupIdFromSessionKey("main")).toBeNull();
  });

  test("keeps parentId on focused file and API payloads when the catalog has it", () => {
    const withFile = toggleChatContextSource(
      DEFAULT_CHAT_CONTEXT_SCOPE,
      { type: "file", id: "doc-roadmap", label: "roadmap.md" },
      CATALOG,
    );
    const withApi = toggleChatContextSource(
      withFile,
      { type: "api", id: "src-crm", label: "CRM" },
      CATALOG,
    );
    expect(withFile.selectedSources).toEqual([
      { type: "file", id: "doc-roadmap", label: "roadmap.md", parentId: "kb-1" },
    ]);
    expect(toChatSendContextScope(withApi, "main", CATALOG)).toEqual({
      mode: "focused",
      lifetime: "turn",
      sources: [
        { type: "file", id: "doc-roadmap", parentId: "kb-1" },
        { type: "api", id: "src-crm", parentId: "kb-team" },
      ],
    });
  });

  test("sends focused sources when the user picks files, folders, or APIs", () => {
    const withFile = toggleChatContextSource(DEFAULT_CHAT_CONTEXT_SCOPE, {
      type: "file",
      id: "doc-roadmap",
      label: "roadmap.md",
    });
    const withFolder = toggleChatContextSource(withFile, {
      type: "folder",
      id: "lfb-design",
      label: "设计稿",
    });
    expect(toChatSendContextScope(withFolder, "main")).toEqual({
      mode: "focused",
      lifetime: "turn",
      sources: [
        { type: "file", id: "doc-roadmap" },
        { type: "folder", id: "lfb-design" },
      ],
    });
  });

  test("selecting a knowledge space drops descendant sources from the payload", () => {
    const withFile = toggleChatContextSource(
      DEFAULT_CHAT_CONTEXT_SCOPE,
      { type: "file", id: "doc-roadmap", label: "roadmap.md" },
      CATALOG,
    );
    const withSpace = toggleChatContextSource(
      withFile,
      { type: "knowledge", id: "kb-1", label: "产品资料" },
      CATALOG,
    );
    expect(withSpace.selectedSources).toEqual([
      { type: "knowledge", id: "kb-1", label: "产品资料" },
    ]);
    expect(toChatSendContextScope(withSpace, "main", CATALOG)).toEqual({
      mode: "focused",
      lifetime: "turn",
      sources: [{ type: "knowledge", id: "kb-1" }],
    });
    expect(
      resolveContextSourceCheckState(
        CATALOG.find((item) => item.id === "doc-roadmap")!,
        new Set(["knowledge:kb-1"]),
        CATALOG,
      ),
    ).toBe("covered");
    expect(
      toggleChatContextSource(
        withSpace,
        { type: "file", id: "doc-roadmap", label: "roadmap.md" },
        CATALOG,
      ).selectedSources,
    ).toEqual(withSpace.selectedSources);
  });

  test("compact ignores descendants when a parent is also selected", () => {
    expect(
      compactChatContextSources(
        [
          { type: "knowledge", id: "kb-1", label: "产品资料" },
          { type: "file", id: "doc-roadmap", label: "roadmap.md" },
        ],
        CATALOG,
      ),
    ).toEqual([{ type: "knowledge", id: "kb-1", label: "产品资料" }]);
  });

  test("maps deep search to deep mode and can keep focused sources", () => {
    const deepOnly = applyDeepSearchToggle(DEFAULT_CHAT_CONTEXT_SCOPE);
    expect(toChatSendContextScope(deepOnly, "main")).toEqual({
      mode: "deep",
      lifetime: "turn",
    });
    const withFile = toggleChatContextSource(deepOnly, {
      type: "file",
      id: "doc-roadmap",
      label: "roadmap.md",
    });
    expect(toChatSendContextScope(withFile, "main")).toEqual({
      mode: "deep",
      lifetime: "turn",
      sources: [{ type: "file", id: "doc-roadmap" }],
    });
  });

  test("conversation only clears sources and deep search", () => {
    const selected = toggleChatContextSource(applyDeepSearchToggle(DEFAULT_CHAT_CONTEXT_SCOPE), {
      type: "file",
      id: "doc-roadmap",
      label: "roadmap.md",
    });
    const conversationOnly = applyConversationOnlyScope(selected);
    expect(conversationOnly).toMatchObject({
      preset: "conversation",
      selectedSources: [],
      deepEnabled: false,
      pickerOpen: true,
    });
    expect(toChatSendContextScope(conversationOnly, "main")).toEqual({
      mode: "minimal",
      lifetime: "turn",
    });
  });

  test("filters the source catalog by kind and query", () => {
    const items = parseContextScopeCatalog([
      { type: "file", id: "doc-1", label: "roadmap.md", subtitle: "产品资料" },
      { type: "api", id: "src-crm", label: "CRM" },
      { type: "folder", id: "  ", label: "bad" },
    ]);
    expect(items).toEqual([
      { type: "file", id: "doc-1", label: "roadmap.md", subtitle: "产品资料" },
      { type: "api", id: "src-crm", label: "CRM" },
    ]);
    expect(filterContextScopeCatalog(items, "crm", "all").map((item) => item.id)).toEqual([
      "src-crm",
    ]);
    expect(filterContextScopeCatalog(items, "", "file").map((item) => item.id)).toEqual(["doc-1"]);
  });

  test("builds a visibility-grouped catalog tree and filters in place", () => {
    const tree = buildContextScopeCatalogTree(CATALOG);
    expect(tree.map((group) => group.visibility)).toEqual(["private", "team"]);
    expect(tree[0]?.nodes.map((node) => node.item.id)).toEqual(["kb-1"]);
    expect(tree[0]?.nodes[0]?.children.map((node) => node.item.id)).toEqual([
      "doc-roadmap",
      "lfb-design",
    ]);
    expect(tree[1]?.nodes[0]?.item.hasConflict).toBe(true);

    const filtered = filterContextScopeCatalogTree(tree, "crm");
    expect(filtered.groups.map((group) => group.visibility)).toEqual(["team"]);
    expect(filtered.groups[0]?.nodes[0]?.children.map((node) => node.item.id)).toEqual(["src-crm"]);
    expect(filtered.expandedKeys).toContain("knowledge:kb-team");
  });

  test("maps knowledge_finished consume receipts onto the picker state", () => {
    expect(
      parseConsumeReceiptsFromAgentEvent({
        data: { event: "chat.context_expansion_suggested", consumeReceipts: [] },
      }),
    ).toBeNull();
    const receipts = parseConsumeReceiptsFromAgentEvent({
      sessionKey: "main",
      data: {
        event: "chat.knowledge_finished",
        consumeReceipts: [
          {
            ref: { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-1" },
            status: "consumed",
          },
          {
            ref: { type: "api", id: "src-crm", parentId: "kb-team" },
            status: "denied",
            reasonCode: "permission_denied",
          },
        ],
      },
    });
    expect(receipts).toEqual([
      { type: "file", id: "doc-roadmap", parentId: "kb-1", status: "consumed" },
      {
        type: "api",
        id: "src-crm",
        parentId: "kb-team",
        status: "denied",
        reasonCode: "permission_denied",
      },
    ]);
    const labeled = applyConsumeReceipts(DEFAULT_CHAT_CONTEXT_SCOPE, receipts ?? [], CATALOG);
    expect(labeled.consumeReceipts[0]?.label).toBe("roadmap.md");
    expect(labeled.consumeReceipts[1]?.label).toBe("CRM");
  });
});

describe("chat context reading summary", () => {
  test("uses the first file name and the real file count", () => {
    expect(
      summarizeContextReadingSources([{ type: "file", id: "doc-a", label: "roadmap.md" }]),
    ).toEqual({ kind: "file", name: "roadmap.md", count: 1 });
    expect(
      summarizeContextReadingSources([
        { type: "file", id: "doc-a", label: "roadmap.md" },
        { type: "file", id: "doc-b", label: "notes.txt" },
        { type: "knowledge", id: "kb-1", label: "产品资料" },
      ]),
    ).toEqual({ kind: "file", name: "roadmap.md", count: 2 });
  });

  test("uses the first folder name and the real folder count", () => {
    expect(
      summarizeContextReadingSources([{ type: "folder", id: "lfb-1", label: "设计稿" }]),
    ).toEqual({ kind: "folder", name: "设计稿", count: 1 });
    expect(
      summarizeContextReadingSources([
        { type: "folder", id: "lfb-1", label: "设计稿" },
        { type: "folder", id: "lfb-2", label: "合同" },
        { type: "folder", id: "lfb-3", label: "素材" },
      ]),
    ).toEqual({ kind: "folder", name: "设计稿", count: 3 });
  });

  test("ignores knowledge-only selections", () => {
    expect(
      summarizeContextReadingSources([{ type: "knowledge", id: "kb-1", label: "小组收录" }]),
    ).toBeNull();
  });
});
