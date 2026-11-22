import { afterEach, describe, expect, it } from "vitest";
import {
  ensureRobotDataSurface,
  openRobotDataItem,
  peekRobotDataSurface,
  resetRobotDataSurfaceForTests,
} from "./my-bot-data-surface.ts";

afterEach(() => {
  resetRobotDataSurfaceForTests();
});

describe("robot data surface", () => {
  it("edits a document summary through its maintenance RPC and reloads", async () => {
    let saved = false;
    const client = {
      request: async (method: string, params?: unknown) => {
        if (method === "knowledge.document.preview") {
          return { text: "original" };
        }
        if (method === "knowledge.document.summary") {
          const record = params as { fields?: unknown };
          if (record.fields) {
            saved = true;
          }
          return {
            summary: {
              state: "ready",
              fields: {
                purpose: saved ? "edited" : "initial",
                keyPoints: [],
                coverage: [],
                entities: [],
                boundaries: [],
              },
            },
          };
        }
        if (method === "agents.files.list") {
          return { files: [] };
        }
        if (method === "data.memory.list") {
          return { entries: [], atoms: [] };
        }
        if (method === "knowledge.base.list") {
          return { knowledgeBases: [] };
        }
        if (method === "agents.files.get") {
          return { file: { missing: true } };
        }
        throw Error(method);
      },
    };
    await ensureRobotDataSurface({ client, connected: true }, "law", () => undefined);
    await openRobotDataItem(
      { client, connected: true },
      {
        kind: "knowledge",
        agentId: "law",
        knowledgeBaseId: "kb",
        documentId: "doc",
        title: "Doc",
      },
      () => undefined,
    );
    const state = peekRobotDataSurface("law")?.open;
    expect(state?.text).toContain("initial");
    await state?.editSummary?.(
      JSON.stringify({
        purpose: "edited",
        keyPoints: [],
        coverage: [],
        entities: [],
        boundaries: [],
      }),
    );
    expect(saved).toBe(true);
    expect(peekRobotDataSurface("law")?.open?.text).toContain("edited");
  });

  it("loads the workspace path, memory ledger, and only knowledge bound to this robot", async () => {
    const requests: string[] = [];
    const client = {
      request: async (method: string, params?: unknown) => {
        requests.push(method);
        const record = params as { name?: string; knowledgeBaseId?: string };
        if (method === "agents.files.list") {
          return {
            workspace: "/robots/law/workspace",
            files: [
              { name: "SOUL.md", missing: false, size: 40 },
              { name: "MEMORY.md", missing: true },
            ],
          };
        }
        if (method === "data.memory.list") {
          return { entries: [], atoms: [{ id: "atom-1", summary: "上次合同用了保守口径" }] };
        }
        if (method === "knowledge.base.list") {
          return {
            knowledgeBases: [
              { id: "kb-law", title: "法务知识库", robotIds: ["law"] },
              { id: "kb-other", title: "其他", robotIds: ["sales"] },
            ],
          };
        }
        if (method === "knowledge.base.documents.list") {
          return { documents: [{ docId: "doc-1", title: "合同审查手册" }] };
        }
        if (method === "agents.files.get" && record.name === "memory/task_ledger.json") {
          return { file: { name: record.name, missing: false, size: 18, content: '{"ok":true}' } };
        }
        throw new Error(`missing ${method}`);
      },
    };
    await ensureRobotDataSurface({ client, connected: true }, "law", () => undefined);
    const surface = peekRobotDataSurface("law");
    expect(surface?.workspace).toBe("/robots/law/workspace");
    expect(surface?.workspaceFiles.map((file) => file.name)).toEqual(["SOUL.md"]);
    expect(surface?.memoryFiles.map((file) => file.name)).toContain("memory/task_ledger.json");
    expect(surface?.atoms[0]?.text).toBe("上次合同用了保守口径");
    expect(surface?.knowledge).toEqual([
      {
        knowledgeBaseId: "kb-law",
        documentId: "doc-1",
        title: "合同审查手册",
        baseTitle: "法务知识库",
      },
    ]);
    expect(requests).toContain("agents.files.get");

    await openRobotDataItem(
      { client, connected: true },
      {
        kind: "file",
        agentId: "law",
        name: "memory/task_ledger.json",
        label: "memory/task_ledger.json",
      },
      () => undefined,
    );
    expect(peekRobotDataSurface("law")?.open?.text).toBe('{"ok":true}');
  });
});
