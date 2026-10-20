import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import {
  decodeKnowledgeDocumentPreviewText,
  isKnowledgeDocumentTextEditable,
  setKnowledgeUniverseHomeCockpitTab,
} from "./knowledge-universe-document-reader.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function makeState(): AppPortState {
  return {
    client: null,
    requestUpdate: vi.fn(),
  } as unknown as AppPortState;
}

describe("knowledge universe document reader controller", () => {
  it("decodes preview bytes into text", () => {
    expect(
      decodeKnowledgeDocumentPreviewText({
        filename: "notes.md",
        mimeType: "text/markdown",
        byteLength: 5,
        textLike: true,
        base64: Buffer.from("hello").toString("base64"),
      }),
    ).toBe("hello");
  });

  it("only treats chat-compatible text lanes as editable", () => {
    expect(
      isKnowledgeDocumentTextEditable({
        filename: "notes.md",
        mimeType: "text/markdown",
        byteLength: 5,
        textLike: true,
        base64: Buffer.from("hello").toString("base64"),
      }),
    ).toBe(true);
    expect(
      isKnowledgeDocumentTextEditable({
        filename: "page.html",
        mimeType: "text/html",
        byteLength: 12,
        textLike: true,
        base64: Buffer.from("<html></html>").toString("base64"),
      }),
    ).toBe(false);
    expect(
      isKnowledgeDocumentTextEditable({
        filename: "form.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteLength: 8,
        textLike: false,
        renderKind: "html",
        html: "<p>doc</p>",
      }),
    ).toBe(false);
  });

  it("switches the home cockpit to the document tab", () => {
    const state = makeState();
    setKnowledgeUniverseHomeCockpitTab(state, "document");
    expect(getKnowledgeUniverseRuntime(state).homeCockpitTab).toBe("document");
  });
});
