import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import { GatewayRequestError } from "../gateway.ts";

const previewKnowledgeDocument = vi.fn();
const applyWorkspaceFilePreview = vi.fn(() => "text" as const);

const runtime = {
  personalActionError: null as string | null,
  personalActionNotice: null as string | null,
  personalActionBusy: false,
};

vi.mock("../capability/knowledge-universe/gateway-client.ts", () => ({
  createKnowledgeUniverseGateway: () => ({
    previewKnowledgeDocument,
  }),
}));

vi.mock("../wiring/workspace-file-preview.ts", () => ({
  applyWorkspaceFilePreview,
  createBlobUrlFromBase64: vi.fn(() => null),
}));

vi.mock("./knowledge-universe.ts", () => ({
  getKnowledgeUniverseRuntime: () => runtime,
  requireSelectedKnowledgeBaseId: () => "kb-1",
}));

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

const { previewKnowledgeUniverseOriginalDocument } =
  await import("./knowledge-universe-original-preview.ts");

function makeState(): AppPortState {
  return {
    client: {} as never,
    requestUpdate: vi.fn(),
    sidebarPreviewMode: "markdown",
    sidebarArtifactWorkspace: null,
    sidebarContent: null,
    sidebarError: null,
    sidebarOpen: false,
    knowledgeUniversePersonalActionError: null,
    knowledgeUniversePersonalActionNotice: null,
    knowledgeUniversePersonalActionBusy: false,
  } as unknown as AppPortState;
}

describe("previewKnowledgeUniverseOriginalDocument", () => {
  beforeEach(() => {
    previewKnowledgeDocument.mockReset();
    applyWorkspaceFilePreview.mockClear();
    runtime.personalActionError = null;
    runtime.personalActionNotice = null;
    runtime.personalActionBusy = false;
  });

  it("applies sidebar preview when original bytes are available", async () => {
    previewKnowledgeDocument.mockResolvedValue({
      filename: "guide.md",
      mimeType: "text/markdown",
      byteLength: 10,
      textLike: true,
      base64: btoa("# guide"),
      source: "original_store",
    });
    const state = makeState();
    await previewKnowledgeUniverseOriginalDocument(state, "doc-1");
    expect(previewKnowledgeDocument).toHaveBeenCalledWith({
      knowledgeBaseId: "kb-1",
      documentId: "doc-1",
      render: true,
    });
    expect(applyWorkspaceFilePreview).toHaveBeenCalled();
    expect(state.sidebarOpen).toBe(true);
    expect(state.knowledgeUniversePersonalActionNotice).toBe(
      "frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticePreviewOriginal",
    );
  });

  it("surfaces empty-original messaging when preview is unavailable", async () => {
    previewKnowledgeDocument.mockRejectedValue(
      new GatewayRequestError({
        code: "UNAVAILABLE",
        message: "original document was not retained; re-upload to preview",
        details: { reason: "original_not_retained" },
      }),
    );
    const state = makeState();
    await previewKnowledgeUniverseOriginalDocument(state, "doc-missing");
    expect(state.sidebarOpen).toBe(false);
    expect(state.knowledgeUniversePersonalActionError).toBe(
      "frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalUnavailable",
    );
  });
});
