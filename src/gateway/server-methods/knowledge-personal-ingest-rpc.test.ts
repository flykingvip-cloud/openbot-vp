// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { resetKnowledgeRetrievalServiceForTests } from "../../retrieval/retrieval-service.js";
import { resetKnowledgeRetrievalSourceRegistrationForTests } from "../../retrieval/sources/knowledge-source.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-ingest-rpc-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } as KnowledgeSourceContext,
}));

const webFetchState = vi.hoisted(() => ({
  current: { title: "Example", text: "default web text" } as { title?: string; text: string },
}));

const mockProvider: EmbeddingProvider = {
  id: "openai",
  model: "mock-embed",
  embedQuery: async (text) => [text.length % 7, 0.2, 0.4],
  embedBatch: async (texts) => texts.map((text) => [text.length % 7, 0.2, 0.4]),
};

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

vi.mock("../knowledge/kb-ingest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../knowledge/kb-ingest.js")>();
  return {
    ...actual,
    resolveKnowledgeIngestEmbeddingProvider: vi.fn(async () => mockProvider),
  };
});

vi.mock("../../media-understanding/runner.js", () => ({
  resolveAutoImageModel: vi.fn(async () => ({ provider: "openai", model: "gpt-5-mini" })),
}));

vi.mock("../../media-understanding/providers/image-runtime.js", () => ({
  describeImageWithModel: vi.fn(async () => ({
    text: "Invoice 2025\nAmount 1200\nCustomer OpenBot",
    model: "gpt-5-mini",
  })),
}));

// Stub only the outbound web fetch; ingestion + object creation stay real so the
// web reference is genuinely chunk-indexed and searchable in tests.
vi.mock("../knowledge/personal-knowledge-ingest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../knowledge/personal-knowledge-ingest.js")>();
  return {
    ...actual,
    fetchWebPageForKnowledge: vi.fn(async () => webFetchState.current),
  };
});

const { knowledgeHandlers } = await import("./knowledge.js");
const { listPersonalSkillAssets } = await import("../skill-lifecycle-store.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}> {
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "test@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

function extractKnowledgeBaseId(payload: Record<string, unknown> | undefined): string {
  const kb = payload?.knowledgeBase;
  if (!kb || typeof kb !== "object") {
    throw new Error("expected knowledgeBase in payload");
  }
  const id = (kb as { id?: unknown }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("expected knowledgeBase.id in payload");
  }
  return id;
}

function setContext(context: Partial<KnowledgeSourceContext> & { userId: string | null }) {
  contextState.current = {
    userId: context.userId,
    seatId: context.seatId ?? null,
    tenantId: context.tenantId ?? null,
    hasEnterpriseScope: context.hasEnterpriseScope ?? Boolean(context.tenantId),
    teamLabel: context.teamLabel ?? null,
    roleCode: context.roleCode ?? null,
    departmentId: context.departmentId ?? null,
  };
}

describe("knowledge personal ingest RPC", () => {
  beforeEach(() => {
    cleanStore();
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    contextState.current = {
      userId: "user-a",
      seatId: null,
      tenantId: null,
      hasEnterpriseScope: false,
    };
    webFetchState.current = { title: "Example", text: "default web text" };
  });

  afterEach(() => {
    cleanStore();
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
  });

  it("upload with knowledgeBaseId ingests and becomes searchable", async () => {
    const created = await invoke("knowledge.base.create", { title: "Upload KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "runbook.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Runbook\nRestart gateway after deploy.",
      },
    });
    expect(uploaded.ok).toBe(true);
    const ingest = uploaded.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Restart gateway",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
    const evidence = search.payload?.evidence as Array<{ chunkText?: string }>;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]?.chunkText).toContain("Restart gateway");
  });

  it("uploads image with OCR, ingests it, and becomes searchable", async () => {
    const created = await invoke("knowledge.base.create", { title: "Image KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "invoice.png",
        mimeType: "image/png",
        size: 32,
        kind: "image",
        dataUrl: `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`,
      },
    });
    expect(uploaded.ok).toBe(true);
    expect((uploaded.payload?.object as { title?: string } | undefined)?.title).toBe("invoice");
    const ingest = uploaded.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Amount 1200",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
    const evidence = search.payload?.evidence as Array<{ chunkText?: string }>;
    expect(evidence[0]?.chunkText).toContain("Amount 1200");
  });

  it("dedupes duplicate uploads in the same knowledge base", async () => {
    const created = await invoke("knowledge.base.create", { title: "Dedup KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const first = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "runbook.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Runbook\nRestart gateway after deploy.",
      },
    });
    expect(first.ok).toBe(true);

    const second = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "runbook-copy.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Runbook\nRestart gateway after deploy.",
      },
    });
    expect(second.ok).toBe(true);
    expect(second.payload?.deduped).toBe(true);
    const secondIngest = second.payload?.ingest as { skipped?: boolean; reason?: string };
    expect(secondIngest?.skipped).toBe(true);
    expect(secondIngest?.reason).toContain("duplicate");

    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    const documents = docs.payload?.documents as Array<{ title?: string }> | undefined;
    expect(documents).toHaveLength(1);
    expect(documents?.[0]?.title).toBe("runbook");
  });

  it("hard-deletes a knowledge-base source document and removes it from the list", async () => {
    const created = await invoke("knowledge.base.create", { title: "Delete KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "delete-me.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Delete me\nThis document should disappear.",
      },
    });
    expect(uploaded.ok).toBe(true);
    const skillId = (uploaded.payload?.skillId as string | undefined) ?? "";
    expect(skillId).toBeTruthy();

    const before = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(before.ok).toBe(true);
    const beforeSources = before.payload?.sources as Array<{ documentId?: string }> | undefined;
    expect(beforeSources?.some((item) => item.documentId === skillId)).toBe(true);

    const deleted = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: kbId,
      documentId: skillId,
    });
    expect(deleted.ok).toBe(true);

    const after = await invoke("knowledge.base.sources.list", { knowledgeBaseId: kbId });
    expect(after.ok).toBe(true);
    const afterSources = after.payload?.sources as Array<{ documentId?: string }> | undefined;
    expect(afterSources ?? []).toEqual([]);

    expect(listPersonalSkillAssets().some((item) => item.id === skillId)).toBe(false);
  });

  it("deleting from one knowledge base keeps a shared document available in another knowledge base", async () => {
    const firstKb = await invoke("knowledge.base.create", { title: "Primary KB" });
    const firstKbId = extractKnowledgeBaseId(firstKb.payload);
    const secondKb = await invoke("knowledge.base.create", { title: "Shared KB" });
    const secondKbId = extractKnowledgeBaseId(secondKb.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: firstKbId,
      attachment: {
        fileName: "shared.md",
        mimeType: "text/markdown",
        size: 64,
        kind: "text",
        textContent: "# Shared\nReusable content across spaces.",
      },
    });
    expect(uploaded.ok).toBe(true);
    const skillId = (uploaded.payload?.skillId as string | undefined) ?? "";
    expect(skillId).toBeTruthy();

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: secondKbId,
      documentId: skillId,
    });
    expect(attached.ok).toBe(true);

    const deleted = await invoke("knowledge.base.documents.delete", {
      knowledgeBaseId: firstKbId,
      documentId: skillId,
    });
    expect(deleted.ok).toBe(true);

    const firstSources = await invoke("knowledge.base.sources.list", {
      knowledgeBaseId: firstKbId,
    });
    expect(firstSources.ok).toBe(true);
    const firstItems = firstSources.payload?.sources as Array<{ documentId?: string }> | undefined;
    expect(firstItems?.some((item) => item.documentId === skillId)).toBe(false);

    const secondSources = await invoke("knowledge.base.sources.list", {
      knowledgeBaseId: secondKbId,
    });
    expect(secondSources.ok).toBe(true);
    const secondItems = secondSources.payload?.sources as
      | Array<{ documentId?: string }>
      | undefined;
    expect(secondItems?.some((item) => item.documentId === skillId)).toBe(true);

    expect(listPersonalSkillAssets().some((item) => item.id === skillId)).toBe(true);
  });

  it("rejects unsupported office documents instead of silently storing placeholders", async () => {
    const created = await invoke("knowledge.base.create", { title: "Office KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "legacy.xls",
        mimeType: "application/vnd.ms-excel",
        size: 64,
        kind: "binary",
        dataUrl: `data:application/vnd.ms-excel;base64,${Buffer.from("xls").toString("base64")}`,
      },
    });

    expect(uploaded.ok).toBe(false);
    expect(uploaded.error?.message).toContain("旧版 Word/Excel/PPT");
  });

  it("uploads docx with knowledgeBaseId, ingests it, and keeps the real title", async () => {
    const created = await invoke("knowledge.base.create", { title: "Docx KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:body>
           <w:p><w:r><w:t>中医可以培育洞察力</w:t></w:r></w:p>
           <w:p><w:r><w:t>Quarterly insight training needs case studies.</w:t></w:r></w:p>
         </w:body>
       </w:document>`,
    );
    const docx = await zip.generateAsync({ type: "nodebuffer" });

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "中医可以培育洞察力.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: docx.length,
        kind: "binary",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString("base64")}`,
      },
    });
    expect(uploaded.ok).toBe(true);
    const ingest = uploaded.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);
    expect((uploaded.payload?.object as { title?: string } | undefined)?.title).toBe(
      "中医可以培育洞察力",
    );

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    expect(got.ok).toBe(true);
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] };
    expect((kb.documentIds ?? []).length).toBe(1);

    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    const documents = docs.payload?.documents as Array<{ title?: string }> | undefined;
    expect(documents?.[0]?.title).toBe("中医可以培育洞察力");

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Quarterly insight",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
    const evidence = search.payload?.evidence as Array<{ chunkText?: string }>;
    expect(evidence[0]?.chunkText).toContain("Quarterly insight training");
  });

  it("uploads xlsx with knowledgeBaseId, ingests it, and keeps the real title", async () => {
    const created = await invoke("knowledge.base.create", { title: "Xlsx KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <si><t>Quarterly pipeline</t></si>
         <si><t>EMEA</t></si>
       </sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <sheetData>
           <row r="1"><c r="A1" t="s"><v>0</v></c></row>
           <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>120</v></c></row>
         </sheetData>
       </worksheet>`,
    );
    const xlsx = await zip.generateAsync({ type: "nodebuffer" });

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "销售线索台账.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: xlsx.length,
        kind: "binary",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsx.toString("base64")}`,
      },
    });
    expect(uploaded.ok).toBe(true);
    const ingest = uploaded.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);
    expect((uploaded.payload?.object as { title?: string } | undefined)?.title).toBe(
      "销售线索台账",
    );

    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    const documents = docs.payload?.documents as Array<{ title?: string }> | undefined;
    expect(documents?.[0]?.title).toBe("销售线索台账");

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Quarterly pipeline",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
    const evidence = search.payload?.evidence as Array<{ chunkText?: string }>;
    expect(evidence[0]?.chunkText).toContain("Quarterly pipeline");
  });

  it("uploads pptx with knowledgeBaseId, ingests it, and keeps the real title", async () => {
    const created = await invoke("knowledge.base.create", { title: "Pptx KB" });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
         <p:cSld>
           <p:spTree>
             <p:sp>
               <p:txBody>
                 <a:p><a:r><a:t>Launch deck</a:t></a:r></a:p>
                 <a:p><a:r><a:t>Channel strategy</a:t></a:r></a:p>
               </p:txBody>
             </p:sp>
           </p:spTree>
         </p:cSld>
       </p:sld>`,
    );
    const pptx = await zip.generateAsync({ type: "nodebuffer" });

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "产品发布演示稿.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: pptx.length,
        kind: "binary",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${pptx.toString("base64")}`,
      },
    });
    expect(uploaded.ok).toBe(true);
    const ingest = uploaded.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);
    expect((uploaded.payload?.object as { title?: string } | undefined)?.title).toBe(
      "产品发布演示稿",
    );

    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    const documents = docs.payload?.documents as Array<{ title?: string }> | undefined;
    expect(documents?.[0]?.title).toBe("产品发布演示稿");

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Launch deck",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
    const evidence = search.payload?.evidence as Array<{ chunkText?: string }>;
    expect(evidence[0]?.chunkText).toContain("Launch deck");
  });

  it("upload ingestOptions adjust chunking strategy", async () => {
    const created = await invoke("knowledge.base.create", { title: "Chunking KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const longBody = Array.from(
      { length: 60 },
      (_, index) => `Section ${index}\n${"detail ".repeat(40)}`,
    ).join("\n\n");

    const fixed = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "long.md",
        mimeType: "text/markdown",
        size: longBody.length,
        kind: "text",
        textContent: longBody,
      },
      ingestOptions: { chunkingStrategy: "fixed" },
    });
    const paragraph = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "long-2.md",
        mimeType: "text/markdown",
        size: `${longBody}\n\nParagraph variant.`.length,
        kind: "text",
        textContent: `${longBody}\n\nParagraph variant.`,
      },
      ingestOptions: { chunkingStrategy: "paragraph" },
    });
    const fixedChunks = (fixed.payload?.ingest as { chunkCount?: number })?.chunkCount ?? 0;
    const paragraphChunks = (paragraph.payload?.ingest as { chunkCount?: number })?.chunkCount ?? 0;
    expect(fixedChunks).toBeGreaterThan(0);
    expect(paragraphChunks).toBeGreaterThan(0);
    expect(fixedChunks).toBeGreaterThan(paragraphChunks);
  });

  it("collect with knowledgeBaseId ingests summary content", async () => {
    const created = await invoke("knowledge.base.create", { title: "Collect KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const collected = await invoke("knowledge.personal.collect", {
      knowledgeBaseId: kbId,
      title: "Customer feedback",
      summary: "Customers want bulk export in the dashboard",
    });
    expect(collected.ok).toBe(true);
    const ingest = collected.payload?.ingest as { skipped?: boolean };
    expect(ingest?.skipped).toBe(false);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "export",
    });
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("collect without knowledgeBaseId auto-attaches to personal inbox and ingests", async () => {
    const collected = await invoke("knowledge.personal.collect", {
      title: "Meeting notes",
      summary: "Discussed quarterly roadmap priorities",
    });
    expect(collected.ok).toBe(true);
    const kbId = collected.payload?.knowledgeBaseId as string | undefined;
    expect(kbId?.startsWith("kb_")).toBe(true);
    const ingest = collected.payload?.ingest as { skipped?: boolean };
    expect(ingest?.skipped).toBe(false);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "roadmap",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("attach re-ingests an existing personal document", async () => {
    const created = await invoke("knowledge.base.create", { title: "Attach KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const uploaded = await invoke("knowledge.personal.upload", {
      attachment: {
        fileName: "faq.md",
        mimeType: "text/markdown",
        size: 32,
        kind: "text",
        textContent: "# FAQ\nPassword reset via email.",
      },
    });
    const skillId = (uploaded.payload?.skillId as string) ?? "";

    const attached = await invoke("knowledge.base.attach", {
      knowledgeBaseId: kbId,
      documentId: skillId,
    });
    expect(attached.ok).toBe(true);
    const ingest = attached.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Password reset",
    });
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("rejects collect/upload with another user's knowledgeBaseId before attach", async () => {
    const created = await invoke("knowledge.base.create", { title: "Owner KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });
    const collected = await invoke("knowledge.personal.collect", {
      knowledgeBaseId: kbId,
      title: "Intrusion",
      summary: "Should not attach to owner KB",
    });
    expect(collected.ok).toBe(false);
    expect(collected.error?.message).toContain("not authorized");

    const uploaded = await invoke("knowledge.personal.upload", {
      knowledgeBaseId: kbId,
      attachment: {
        fileName: "intrusion.md",
        mimeType: "text/markdown",
        size: 16,
        kind: "text",
        textContent: "# Intrusion\nShould not attach.",
      },
    });
    expect(uploaded.ok).toBe(false);

    setContext({ userId: "user-a", tenantId: null, seatId: null, hasEnterpriseScope: false });
    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] } | undefined;
    expect(kb?.documentIds ?? []).toEqual([]);
  });

  it("collectWeb fetches a page, creates an attached object, ingests, and is searchable", async () => {
    const created = await invoke("knowledge.base.create", { title: "Web KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    webFetchState.current = {
      title: "Pricing Guide",
      text: "Enterprise plan includes priority support and single sign-on.",
    };
    const collected = await invoke("knowledge.personal.collectWeb", {
      knowledgeBaseId: kbId,
      url: "https://example.com/pricing",
    });
    expect(collected.ok).toBe(true);
    expect(collected.payload?.url).toBe("https://example.com/pricing");
    const ingest = collected.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).toBe(false);
    expect(ingest?.chunkCount).toBeGreaterThan(0);

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] };
    expect((kb.documentIds ?? []).length).toBe(1);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "priority support",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("collectWeb without knowledgeBaseId auto-attaches to the personal inbox", async () => {
    webFetchState.current = { title: "Notes", text: "Quarterly roadmap priorities for the team." };
    const collected = await invoke("knowledge.personal.collectWeb", {
      url: "https://example.com/notes",
    });
    expect(collected.ok).toBe(true);
    const kbId = collected.payload?.knowledgeBaseId as string | undefined;
    expect(kbId?.startsWith("kb_")).toBe(true);
    const ingest = collected.payload?.ingest as { skipped?: boolean };
    expect(ingest?.skipped).toBe(false);
  });

  it("collectWeb rejects an invalid url and a page with no extractable text", async () => {
    const created = await invoke("knowledge.base.create", { title: "Web KB 2" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const invalid = await invoke("knowledge.personal.collectWeb", {
      knowledgeBaseId: kbId,
      url: "not-a-url",
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.message).toContain("url");

    webFetchState.current = { text: "   " };
    const empty = await invoke("knowledge.personal.collectWeb", {
      knowledgeBaseId: kbId,
      url: "https://example.com/empty",
    });
    expect(empty.ok).toBe(false);
  });

  it("collectWeb accepts client-provided text without server fetch", async () => {
    const created = await invoke("knowledge.base.create", { title: "Clip KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const collected = await invoke("knowledge.personal.collectWeb", {
      knowledgeBaseId: kbId,
      url: "https://intranet.example.com/secret",
      title: "Internal memo",
      text: "Only visible when logged in — clipped from browser.",
    });
    expect(collected.ok).toBe(true);
    expect(collected.payload?.clipSource).toBe("client-text");

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "logged in",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("importDataset bulk-ingests records into the target KB and is searchable", async () => {
    const created = await invoke("knowledge.base.create", { title: "Dataset KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const result = await invoke("knowledge.personal.importDataset", {
      knowledgeBaseId: kbId,
      datasetTitle: "Competitor FAQ",
      records: [
        {
          title: "Pricing",
          text: "Enterprise plan is billed per seat and includes priority support.",
        },
        "Supports SAML single sign-on and automatic reconciliation export.",
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.imported).toBe(2);
    expect(result.payload?.knowledgeBaseId).toBe(kbId);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "priority support",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("importDataset rejects an empty record set", async () => {
    const created = await invoke("knowledge.base.create", { title: "Dataset KB 2" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const result = await invoke("knowledge.personal.importDataset", {
      knowledgeBaseId: kbId,
      records: [],
    });
    expect(result.ok).toBe(false);
  });

  it("web.setRefreshPolicy persists an enabled schedule and run-due reports a count", async () => {
    const created = await invoke("knowledge.base.create", { title: "Refresh KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const set = await invoke("knowledge.web.setRefreshPolicy", {
      knowledgeBaseId: kbId,
      url: "https://example.com/pricing",
      docId: "doc-web",
      enabled: true,
      intervalMs: 3_600_000,
    });
    expect(set.ok).toBe(true);
    const policy = set.payload?.policy as { enabled?: boolean; intervalMs?: number } | undefined;
    expect(policy?.enabled).toBe(true);
    expect(policy?.intervalMs).toBe(3_600_000);

    // Nothing is due immediately after scheduling, but the RPC path runs and reports.
    const run = await invoke("knowledge.web.runDueRefreshes", { knowledgeBaseId: kbId });
    expect(run.ok).toBe(true);
    expect(run.payload?.refreshed).toBe(0);
    expect(Array.isArray(run.payload?.results)).toBe(true);
  });

  it("web.setRefreshPolicy rejects an invalid url", async () => {
    const created = await invoke("knowledge.base.create", { title: "Refresh KB 2" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const result = await invoke("knowledge.web.setRefreshPolicy", {
      knowledgeBaseId: kbId,
      url: "not-a-url",
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it("source.bind registers an active source without indexing it (boundary)", async () => {
    const created = await invoke("knowledge.base.create", { title: "Bind KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const bound = await invoke("knowledge.source.bind", {
      knowledgeBaseId: kbId,
      kind: "api",
      title: "CRM API",
      endpoint: "https://api.example.com/crm",
    });
    expect(bound.ok).toBe(true);
    const binding = bound.payload?.binding as { plane?: string; id?: string };
    expect(binding?.plane).toBe("active");

    const listed = await invoke("knowledge.source.list", { knowledgeBaseId: kbId });
    expect(listed.ok).toBe(true);
    expect((listed.payload as { bindings: unknown[] }).bindings.length).toBe(1);

    // Register-only: binding attaches no document and ingests nothing into the index.
    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] };
    expect(kb.documentIds ?? []).toEqual([]);
  });

  it("source.bind rejects passive source kinds", async () => {
    const created = await invoke("knowledge.base.create", { title: "Bind KB 2" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const result = await invoke("knowledge.source.bind", {
      knowledgeBaseId: kbId,
      kind: "upload",
      title: "doc.md",
    });
    expect(result.ok).toBe(false);
  });

  it("collect without knowledgeBaseId returns compat warning for personal inbox fallback", async () => {
    const result = await invoke("knowledge.personal.collect", {
      title: "Inbox note",
      summary: "compat path",
    });
    expect(result.ok).toBe(true);
    const warnings = result.payload?.compatWarnings as Array<{ code?: string }> | undefined;
    expect(warnings?.some((item) => item.code === "implicit_personal_inbox")).toBe(true);
    expect(typeof result.payload?.knowledgeBaseId).toBe("string");
  });

  it("collect rejects missing knowledgeBaseId when strict flag is enabled", async () => {
    process.env.OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID = "1";
    const result = await invoke("knowledge.personal.collect", {
      title: "Strict note",
      summary: "should fail",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("knowledgeBaseId required");
    delete process.env.OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID;
  });

  it("source.bind inherits knowledge base visibility and ignores request visibility", async () => {
    const created = await invoke("knowledge.base.create", { title: "Bind visibility KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const bound = await invoke("knowledge.source.bind", {
      knowledgeBaseId: kbId,
      kind: "api",
      title: "Metrics API",
      endpoint: "https://api.example.com/metrics",
      visibility: "enterprise",
    });
    expect(bound.ok).toBe(true);
    const binding = bound.payload?.binding as { visibility?: string };
    expect(binding?.visibility).toBe("private");
    const warnings = bound.payload?.compatWarnings as Array<{ code?: string }> | undefined;
    expect(warnings?.some((item) => item.code === "source_bind_visibility_ignored")).toBe(true);
  });

  it("rejects source.bind visibility when reject flag is enabled", async () => {
    process.env.OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY = "1";
    const created = await invoke("knowledge.base.create", { title: "Reject visibility KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const bound = await invoke("knowledge.source.bind", {
      knowledgeBaseId: kbId,
      kind: "api",
      title: "Metrics API",
      endpoint: "https://api.example.com/metrics",
      visibility: "enterprise",
    });
    expect(bound.ok).toBe(false);
    expect(bound.error?.message).toContain("visibility is not accepted");
    delete process.env.OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY;
  });

  it("uploadFolder bulk-imports multiple files into the target KB and is searchable", async () => {
    const created = await invoke("knowledge.base.create", { title: "Folder KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const result = await invoke("knowledge.personal.uploadFolder", {
      knowledgeBaseId: kbId,
      folderName: "ops-handbook",
      attachments: [
        {
          fileName: "ops-handbook/deploy.md",
          mimeType: "text/markdown",
          size: 64,
          kind: "text",
          textContent: "# Deploy\nRestart the gateway after every deploy.",
        },
        {
          fileName: "ops-handbook/oncall.md",
          mimeType: "text/markdown",
          size: 48,
          kind: "text",
          textContent: "# Oncall\nEscalate sev1 incidents within ten minutes.",
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.imported).toBe(2);
    expect(result.payload?.total).toBe(2);
    expect(result.payload?.knowledgeBaseId).toBe(kbId);
    const documents = result.payload?.documents as Array<{ fileName?: string }>;
    expect(documents.map((item) => item.fileName)).toEqual([
      "ops-handbook/deploy.md",
      "ops-handbook/oncall.md",
    ]);

    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] };
    expect((kb.documentIds ?? []).length).toBe(2);

    const search = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "Restart the gateway",
    });
    expect(search.ok).toBe(true);
    expect(search.payload?.searchMode).toBe("indexed");
  });

  it("uploadFolder skips invalid entries but imports the valid ones", async () => {
    const created = await invoke("knowledge.base.create", { title: "Folder KB 2" });
    const kbId = extractKnowledgeBaseId(created.payload);

    const result = await invoke("knowledge.personal.uploadFolder", {
      knowledgeBaseId: kbId,
      attachments: [
        {
          fileName: "good.md",
          mimeType: "text/markdown",
          size: 16,
          kind: "text",
          textContent: "# Good\nKeep me indexed.",
        },
        // missing kind
        { fileName: "bad.md", mimeType: "text/markdown" },
        // unsupported kind value
        { fileName: "wrong.md", mimeType: "text/markdown", size: 4, kind: "frobnicate" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.imported).toBe(1);
    expect(result.payload?.total).toBe(3);
    const skipped = result.payload?.skipped as Array<{ fileName?: string; reason?: string }>;
    expect(skipped.length).toBe(2);
  });

  it("rejects array attachments and array dataset records", async () => {
    const upload = await invoke("knowledge.personal.upload", {
      attachment: [{ fileName: "notes.md", mimeType: "text/markdown", kind: "text" }],
    });
    expect(upload.ok).toBe(false);
    expect(upload.error?.message ?? "").toMatch(/attachment required/i);

    const dataset = await invoke("knowledge.personal.importDataset", {
      records: [["Enterprise plan is billed per seat."]],
    });
    expect(dataset.ok).toBe(false);
    expect(dataset.error?.message ?? "").toMatch(/records required/i);

    const created = await invoke("knowledge.base.create", { title: "Array Attachment KB" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const folder = await invoke("knowledge.personal.uploadFolder", {
      knowledgeBaseId: kbId,
      attachments: [[{ fileName: "nested.md", mimeType: "text/markdown", kind: "text" }]],
    });
    expect(folder.ok).toBe(true);
    expect(folder.payload?.imported).toBe(0);
    expect(folder.payload?.total).toBe(1);
    const skipped = folder.payload?.skipped as Array<{ fileName?: string; reason?: string }>;
    expect(skipped).toEqual([
      expect.objectContaining({ fileName: "#1", reason: "invalid attachment" }),
    ]);
  });

  it("uploadFolder rejects an empty attachment set", async () => {
    const created = await invoke("knowledge.base.create", { title: "Folder KB 3" });
    const kbId = extractKnowledgeBaseId(created.payload);
    const result = await invoke("knowledge.personal.uploadFolder", {
      knowledgeBaseId: kbId,
      attachments: [],
    });
    expect(result.ok).toBe(false);
  });

  it("uploadFolder into another user's KB is rejected before any import", async () => {
    const created = await invoke("knowledge.base.create", { title: "Owner Folder KB" });
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: "user-b", tenantId: null, seatId: null, hasEnterpriseScope: false });
    const result = await invoke("knowledge.personal.uploadFolder", {
      knowledgeBaseId: kbId,
      attachments: [
        {
          fileName: "intrusion.md",
          mimeType: "text/markdown",
          size: 16,
          kind: "text",
          textContent: "# Intrusion\nShould not attach.",
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("not authorized");

    setContext({ userId: "user-a", tenantId: null, seatId: null, hasEnterpriseScope: false });
    const got = await invoke("knowledge.base.get", { knowledgeBaseId: kbId });
    const kb = got.payload?.knowledgeBase as { documentIds?: string[] };
    expect(kb?.documentIds ?? []).toEqual([]);
  });
});
