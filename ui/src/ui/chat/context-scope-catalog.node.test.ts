import { describe, expect, test, vi } from "vitest";
import {
  loadChatContextSourceCatalog,
  parseKnowledgeBaseListCatalog,
  parseKnowledgeBaseSourcesCatalog,
} from "./context-scope-catalog.ts";

describe("chat context catalog fallback", () => {
  test("maps knowledge.base.list rows into knowledge spaces", () => {
    expect(
      parseKnowledgeBaseListCatalog({
        knowledgeBases: [
          { id: "kb-1", title: "产品资料", visibility: "private" },
          { knowledgeBaseId: "kb-2", label: "制度", visibility: "team", conflictCount: 2 },
          { id: "skip", title: "" },
        ],
      }),
    ).toEqual([
      { type: "knowledge", id: "kb-1", label: "产品资料", visibility: "private" },
      { type: "knowledge", id: "kb-2", label: "制度", visibility: "team", hasConflict: true },
    ]);
  });

  test("maps knowledge.base.sources.list rows into files, folders, and APIs", () => {
    expect(
      parseKnowledgeBaseSourcesCatalog(
        { id: "kb-1", visibility: "private" },
        {
          sources: [
            { id: "doc-1", title: "roadmap.md", kind: "document", documentId: "doc-1" },
            { id: "folder-1", title: "设计稿", kind: "localFolder" },
            { id: "api-1", title: "CRM", kind: "api", formatLabel: "/v1/crm" },
          ],
        },
      ),
    ).toEqual([
      {
        type: "file",
        id: "doc-1",
        label: "roadmap.md",
        parentId: "kb-1",
        visibility: "private",
      },
      {
        type: "folder",
        id: "folder-1",
        label: "设计稿",
        parentId: "kb-1",
        visibility: "private",
      },
      {
        type: "api",
        id: "api-1",
        label: "CRM",
        parentId: "kb-1",
        visibility: "private",
        subtitle: "/v1/crm",
      },
    ]);
  });

  test("prefers the catalog RPC and falls back to knowledge bases when it is missing", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "context.scope.sources.catalog") {
        return {
          sources: [{ type: "knowledge", id: "kb-catalog", label: "目录空间", visibility: "team" }],
        };
      }
      throw new Error(method);
    });
    await expect(loadChatContextSourceCatalog(request)).resolves.toEqual([
      { type: "knowledge", id: "kb-catalog", label: "目录空间", visibility: "team" },
    ]);
    expect(request).toHaveBeenCalledTimes(1);

    const fallback = vi.fn(async (method: string) => {
      if (method === "context.scope.sources.catalog") {
        throw new Error("unknown method");
      }
      if (method === "knowledge.base.list") {
        return { knowledgeBases: [{ id: "kb-1", title: "产品资料", visibility: "private" }] };
      }
      if (method === "knowledge.base.sources.list") {
        return { sources: [{ id: "doc-1", title: "roadmap.md", kind: "document" }] };
      }
      throw new Error(method);
    });
    await expect(loadChatContextSourceCatalog(fallback)).resolves.toEqual([
      { type: "knowledge", id: "kb-1", label: "产品资料", visibility: "private" },
      {
        type: "file",
        id: "doc-1",
        label: "roadmap.md",
        parentId: "kb-1",
        visibility: "private",
      },
    ]);
  });
});
