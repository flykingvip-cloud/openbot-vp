import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_CONTEXT_SCOPE, toChatSendContextScope } from "./context-scope.ts";
import {
  applyKnowledgeUniverseSelectionToChatScope,
  knowledgeUniverseSelectionKey,
  knowledgeUniverseSelectionToChatSources,
  syncKnowledgeUniverseSelectionToChatHost,
} from "./knowledge-universe-chat-scope.ts";

const tcm = {
  id: "obj:personal:skill_c0550e28c46b",
  title: "中医诊断学完整笔记",
  source: "personal" as const,
  kind: "document" as const,
  summary: "上传文档",
  tags: ["pdf"],
  updatedAt: 1,
};

describe("knowledge universe chat scope", () => {
  it("maps a selected personal document to a focused file with parent kb", () => {
    expect(
      knowledgeUniverseSelectionToChatSources({
        selectedObject: tcm,
        selectedKnowledgeBaseId: "kb_personal",
        catalog: [
          {
            type: "file",
            id: "skill_c0550e28c46b",
            label: "中医诊断学完整笔记",
            parentId: "kb_personal",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        id: "skill_c0550e28c46b",
        label: "中医诊断学完整笔记",
        parentId: "kb_personal",
      },
    ]);
  });

  it("maps a library object to a knowledge source", () => {
    expect(
      knowledgeUniverseSelectionToChatSources({
        selectedObject: {
          ...tcm,
          id: "obj:kb:kb_a478311b33eb7f81",
          title: "个人资料库",
        },
      }),
    ).toEqual([{ type: "knowledge", id: "kb_a478311b33eb7f81", label: "个人资料库" }]);
  });

  it("maps a knowledge-base home focus to the library, not the sticky id alone", () => {
    expect(
      knowledgeUniverseSelectionToChatSources({
        selectedKnowledgeBaseId: "kb_sticky",
        homeFocus: { kind: "knowledge-base", id: "kb_folder", kbId: "kb_folder" },
        selectedKnowledgeBaseTitle: "设计稿",
      }),
    ).toEqual([{ type: "knowledge", id: "kb_folder", label: "设计稿" }]);
    expect(
      knowledgeUniverseSelectionToChatSources({
        selectedKnowledgeBaseId: "kb_sticky",
      }),
    ).toEqual([]);
  });

  it("pins session lifetime so the selected file survives later sends", () => {
    const sources = knowledgeUniverseSelectionToChatSources({
      selectedObject: tcm,
      selectedKnowledgeBaseId: "kb_personal",
    });
    const next = applyKnowledgeUniverseSelectionToChatScope(DEFAULT_CHAT_CONTEXT_SCOPE, sources);
    expect(next.preset).toBe("custom");
    expect(next.lifetime).toBe("session");
    expect(next.selectedSources).toEqual([
      {
        type: "file",
        id: "skill_c0550e28c46b",
        label: "中医诊断学完整笔记",
        parentId: "kb_personal",
      },
    ]);
    expect(knowledgeUniverseSelectionKey(next.selectedSources)).toContain("skill_c0550e28c46b");
    expect(applyKnowledgeUniverseSelectionToChatScope(next, [])).toEqual({
      ...DEFAULT_CHAT_CONTEXT_SCOPE,
    });
    expect(toChatSendContextScope(next, "agent:main:main", [])).toEqual({
      mode: "focused",
      lifetime: "session",
      sources: [
        {
          type: "file",
          id: "skill_c0550e28c46b",
          parentId: "kb_personal",
        },
      ],
    });
  });

  it("writes the selected file into the chat host and skips unchanged keys", () => {
    const host: {
      chatContextScope?: ReturnType<typeof applyKnowledgeUniverseSelectionToChatScope>;
      chatContextSourceCatalog?: Array<{
        type: "file";
        id: string;
        label: string;
        parentId: string;
      }>;
    } = {
      chatContextScope: { ...DEFAULT_CHAT_CONTEXT_SCOPE },
      chatContextSourceCatalog: [
        {
          type: "file",
          id: "skill_c0550e28c46b",
          label: "中医诊断学完整笔记",
          parentId: "kb_personal",
        },
      ],
    };
    const runtime = {
      selectedObject: tcm,
      selectedKnowledgeBaseId: "kb_personal",
      chatScopeSyncKey: "",
    };
    const key = syncKnowledgeUniverseSelectionToChatHost(host, runtime);
    expect(key).toContain("skill_c0550e28c46b");
    expect(host.chatContextScope?.preset).toBe("custom");
    expect(host.chatContextScope?.selectedSources[0]?.id).toBe("skill_c0550e28c46b");
    const previous = host.chatContextScope;
    runtime.chatScopeSyncKey = key;
    expect(syncKnowledgeUniverseSelectionToChatHost(host, runtime)).toBe(key);
    expect(host.chatContextScope).toBe(previous);
  });
});
