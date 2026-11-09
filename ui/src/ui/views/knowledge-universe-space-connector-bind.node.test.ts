// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
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

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="ku-space-import-http-method"]'),
    ).toBeTruthy();
    expect(container.querySelector<HTMLButtonElement>('input[type="password"]')).toBeTruthy();
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

describe("connector wizard ensure-package button", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });

  function catalogEntry(ready: boolean) {
    return {
      connectorId: "erp-yonyou-tplus",
      label: "用友 T+",
      category: "erp" as const,
      integrationTier: "production" as const,
      credentialKind: "oauth2" as const,
      description: "test",
      defaultSourceKey: "tplus",
      registeredActionCount: ready ? 7 : 0,
      runtimeHandlerCount: ready ? 1 : 0,
      ready,
    };
  }

  function renderWizard(ready: boolean) {
    const draft = createEmptySpaceConnectorBindDraft();
    draft.connectorId = "erp-yonyou-tplus";
    const ensure = vi.fn(async () => undefined);
    const surface = {
      selectedKnowledgeBaseId: "kb-team",
      knowledgeBases: [
        {
          id: "kb-team",
          title: "Team space",
          description: "",
          documentCount: 0,
          visibility: "team",
          updatedAtMs: 1,
        },
      ],
      enterpriseTenantId: "tenant-1",
      personalActionBusy: false,
      libraryWorkspaceBindSourceTitle: "",
      libraryWorkspaceBindSourceEndpoint: "",
      libraryWorkspaceConnectorBindDraft: draft,
      libraryWorkspaceConnectorCatalog: [catalogEntry(ready)],
      libraryWorkspaceConnectorCatalogLoading: false,
      libraryWorkspaceConnectorCatalogError: null,
      libraryWorkspaceConnectorCredentials: [],
      libraryWorkspaceConnectorCredentialsLoading: false,
      libraryWorkspaceConnectorProbeBusy: false,
      libraryWorkspaceConnectorProbeOk: null,
      libraryWorkspaceConnectorProbeMessage: null,
      libraryWorkspaceConnectorOAuthBusy: false,
      libraryWorkspaceConnectorOAuthNotice: null,
      libraryWorkspaceConnectorOAuthError: null,
      libraryWorkspaceConnectorOAuthSimulateAllowed: false,
      libraryWorkspaceConnectorOAuthSessionId: null,
      onLibraryWorkspaceBindSourceDraftChange: vi.fn(),
      onLibraryWorkspaceConnectorBindDraftChange: vi.fn(),
      onLibraryWorkspaceConnectorCredentialSelect: vi.fn(),
      onEnsureConnectorPackageForImport: ensure,
      onTestConnectorConnectionForImport: vi.fn(async () => undefined),
      onBindConnectorSourceToKnowledgeBase: vi.fn(async () => undefined),
      onBindKnowledgeSource: vi.fn(async () => undefined),
    } as unknown as WorkbenchKnowledgeSurface;
    const container = document.createElement("div");
    render(renderActiveSourceBindPanel(surface), container);
    return { container, ensure };
  }

  it("shows install label when connector is not ready", () => {
    const { container } = renderWizard(false);
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-space-import-ensure-package"]',
    );
    expect(button).toBeTruthy();
    expect(button?.textContent?.trim()).toBe("安装连接器包");
  });

  it("shows update label when connector is ready and still calls ensure", () => {
    const { container, ensure } = renderWizard(true);
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="ku-space-import-ensure-package"]',
    );
    expect(button).toBeTruthy();
    expect(button?.textContent?.trim()).toBe("更新连接器包");
    button?.click();
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});
