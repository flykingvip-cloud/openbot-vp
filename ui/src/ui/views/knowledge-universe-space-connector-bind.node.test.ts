// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  buildApiSourceMetadata,
  createEmptySpaceConnectorBindDraft,
  renderActiveSourceBindPanel,
} from "./knowledge-universe-space-connector-bind.ts";

describe("active source HTTP configuration", () => {
  it("renders request method and secret authentication controls", () => {
    const surface = {
      selectedKnowledgeBaseId: "kb-personal",
      knowledgeBases: [
        {
          id: "kb-personal",
          title: "Personal profile",
          description: "",
          documentCount: 0,
          visibility: "private",
          updatedAtMs: 1,
        },
      ],
      enterpriseTenantId: null,
      personalActionBusy: false,
      libraryWorkspaceBindSourceTitle: "",
      libraryWorkspaceBindSourceEndpoint: "",
      libraryWorkspaceConnectorBindDraft: createEmptySpaceConnectorBindDraft(),
      onLibraryWorkspaceBindSourceDraftChange: vi.fn(),
      onLibraryWorkspaceConnectorBindDraftChange: vi.fn(),
      onBindKnowledgeSource: vi.fn(async () => undefined),
    } as unknown as WorkbenchKnowledgeSurface;
    const container = document.createElement("div");

    render(renderActiveSourceBindPanel(surface), container);

    expect(container.querySelector('[data-testid="ku-space-import-http-method"]')).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeTruthy();
    expect(surface.libraryWorkspaceConnectorBindDraft.authHeaderName).toBe("X-API-Key");
  });

  it("builds persisted API authentication metadata", () => {
    const draft = createEmptySpaceConnectorBindDraft();
    draft.authHeaderName = "Authorization";
    draft.apiKey = "Bearer test-key";
    draft.requestMethod = "POST";

    expect(buildApiSourceMetadata(draft)).toEqual({
      "auth.header": "Authorization",
      "auth.apiKey": "Bearer test-key",
      "request.method": "POST",
    });
  });
});
