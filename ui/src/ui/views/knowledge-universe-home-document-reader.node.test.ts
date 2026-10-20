// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderKnowledgeUniverseHomeDocumentReader } from "./knowledge-universe-home-document-reader.ts";

function createSurface(overrides: Partial<WorkbenchKnowledgeSurface> = {}) {
  return {
    homeFocus: null,
    selectedKnowledgeBaseCanWrite: true,
    libraryWorkspaceDocuments: [],
    documentReader: null,
    onDocumentReaderEdit: vi.fn(),
    onDocumentReaderCancel: vi.fn(),
    onDocumentReaderDraftChange: vi.fn(),
    onDocumentReaderSave: vi.fn(async () => undefined),
    onDocumentReaderDelete: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as WorkbenchKnowledgeSurface;
}

let host: HTMLDivElement | null = null;

function mount(surface: WorkbenchKnowledgeSurface) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(renderKnowledgeUniverseHomeDocumentReader(surface), container);
  host = container;
  return container;
}

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  host?.remove();
  host = null;
});

describe("knowledge universe home document reader", () => {
  it("asks the user to pick a file when nothing is focused", () => {
    const container = mount(createSurface());
    expect(
      container.querySelector('[data-testid="ku-home-document-reader"]')?.textContent,
    ).toContain("从左侧知识库或成果中心选择一份文件");
  });

  it("isolates office HTML in a sandboxed frame so workbench CSS cannot crush tables", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "document", id: "doc-1", kbId: "kb-1" },
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "kb-1::doc-1",
          preview: {
            filename: "form.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            byteLength: 12,
            textLike: false,
            renderKind: "html",
            html: "<table><tr><td>姓名</td><td>马仲聪</td></tr></table>",
          },
          draftText: "",
        },
      }),
    );
    const frame = container.querySelector<HTMLIFrameElement>('[data-testid="ku-doc-reader-html"]');
    expect(frame?.tagName).toBe("IFRAME");
    expect(frame?.hasAttribute("sandbox")).toBe(true);
    const source = frame?.getAttribute("srcdoc") || "";
    const blobSrc = frame?.getAttribute("src") || "";
    expect(source.includes("data-openbot-doc-preview") || blobSrc.startsWith("blob:")).toBe(true);
  });

  it("renders text preview and write actions for a digitized file", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "document", id: "doc-1", kbId: "kb-1" },
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "kb-1::doc-1",
          preview: {
            filename: "notes.md",
            mimeType: "text/markdown",
            byteLength: 12,
            textLike: true,
            base64: btoa("hello notes"),
          },
          draftText: "hello notes",
        },
      }),
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-text"]')?.textContent).toContain(
      "hello notes",
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-edit"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-delete"]')).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="ku-doc-reader-edit"]')
        ?.classList.contains("artifact-preview-action"),
    ).toBe(true);
    expect(container.querySelector('[data-testid="ku-doc-reader-download"]')).toBeTruthy();
  });

  it("reuses chat binary copy for legacy office that cannot inline-preview", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "document", id: "doc-1", kbId: "kb-1" },
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "kb-1::doc-1",
          preview: {
            filename: "legacy.doc",
            mimeType: "application/msword",
            byteLength: 8,
            textLike: false,
            base64: btoa("ole-doc"),
          },
          draftText: "",
        },
      }),
    );
    const binary = container.querySelector('[data-testid="ku-doc-reader-binary"]');
    expect(binary?.textContent).toContain("暂不支持在线预览");
    expect(binary?.textContent).toContain("可下载到本地");
    expect(container.querySelector('[data-testid="ku-doc-reader-edit"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-doc-reader-download"]')).toBeTruthy();
  });

  it("does not expose text edit for html pages that use the html lane", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "document", id: "doc-1", kbId: "kb-1" },
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "kb-1::doc-1",
          preview: {
            filename: "report.html",
            mimeType: "text/html",
            byteLength: 20,
            textLike: true,
            base64: btoa("<html><body>page</body></html>"),
          },
          draftText: "",
        },
      }),
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-html"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-edit"]')).toBeFalsy();
  });

  it("previews a focused deliverable without library write actions", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "deliverable", id: "dlv-1" },
        selectedKnowledgeBaseCanWrite: true,
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: null,
          docKey: "deliverable::dlv-1",
          preview: {
            filename: "resume.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            byteLength: 20,
            textLike: false,
            renderKind: "html",
            html: "<p>Alice resume</p>",
          },
          draftText: "",
        },
      }),
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-html"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-delete"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-doc-reader-edit"]')).toBeFalsy();
  });

  it("shows the not-digitized badge for catalog-only files", () => {
    const container = mount(
      createSurface({
        homeFocus: { kind: "document", id: "doc-1", kbId: "kb-1" },
        libraryWorkspaceDocuments: [{ docId: "doc-1", title: "旧 PDF", indexed: false }] as never,
        documentReader: {
          loading: false,
          saving: false,
          editing: false,
          dirty: false,
          error: "这篇文件只有目录卡片，没有正文。请重新上传或绑定原件后再阅读。",
          docKey: "kb-1::doc-1",
          preview: null,
          draftText: "",
        },
      }),
    );
    expect(container.querySelector('[data-testid="ku-doc-reader-not-indexed"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-doc-reader-error"]')?.textContent).toContain(
      "目录卡片",
    );
  });
});
