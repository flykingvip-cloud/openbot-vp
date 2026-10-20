/**
 * Vault Sync form Chromium DOM (Wave S / Wave U).
 * Renders `renderVaultSyncImportForm` directly — product 录入知识 entry no longer mounts Vault
 * (入口 TBD；方案 A / 本地文件夹·同步方式 已废止 2026-07-23).
 */
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { createEmptySpaceConnectorBindDraft } from "./knowledge-universe-space-connector-bind.ts";
import { renderVaultSyncImportForm } from "./knowledge-universe-space-import-vault-sync.ts";
import "../../styles.css";

function vaultSurface(
  overrides: Partial<WorkbenchKnowledgeSurface> = {},
): WorkbenchKnowledgeSurface {
  return {
    selectedKnowledgeBaseId: "kb-team",
    knowledgeBases: [
      {
        id: "kb-team",
        title: "人力资源",
        description: "",
        documentCount: 0,
        visibility: "team",
        updatedAtMs: Date.now(),
      },
    ],
    libraryWorkspaceImportOpen: true,
    libraryWorkspaceImportLockSpace: true,
    libraryWorkspaceImportKind: "localFolder",
    libraryWorkspaceLocalFolderMode: "managed_push",
    personalActionBusy: false,
    vaultSyncRootPath: "",
    vaultSyncPassword: "",
    vaultSyncVaultId: null,
    vaultSyncDeviceId: null,
    onLibraryWorkspaceImportKindChange: vi.fn(),
    onVaultSyncPasswordChange: vi.fn(),
    onPickVaultSyncFolder: vi.fn(async () => undefined),
    onCreateVaultSync: vi.fn(async () => undefined),
    onSyncVaultNow: vi.fn(async () => undefined),
    libraryWorkspaceConnectorBindDraft: createEmptySpaceConnectorBindDraft(),
    ...overrides,
  } as unknown as WorkbenchKnowledgeSurface;
}

describe("Vault Sync form Chromium (Wave S / U — no product import entry)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders E2EE vault form with create + pick-folder controls", () => {
    const mock = vaultSurface();
    render(renderVaultSyncImportForm(mock), container);

    expect(container.querySelector('[data-testid="ku-space-import-form-vaultSync"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-sync-method-vault"]'),
    ).toBeFalsy();
    expect(container.querySelector('[data-testid="ku-space-import-vault-password"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-vault-pick-folder"]'),
    ).toBeTruthy();
    const submit = container.querySelector(
      '[data-testid="ku-space-import-vault-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables create when password is set and fires onCreateVaultSync", async () => {
    const onCreateVaultSync = vi.fn(async () => undefined);
    const mock = vaultSurface({
      vaultSyncPassword: "test-passphrase",
      onCreateVaultSync,
    });
    render(renderVaultSyncImportForm(mock), container);

    const submit = container.querySelector(
      '[data-testid="ku-space-import-vault-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(onCreateVaultSync).toHaveBeenCalledOnce();
  });

  it("shows sync-now after vault session exists", () => {
    const mock = vaultSurface({
      vaultSyncPassword: "test-passphrase",
      vaultSyncVaultId: "vault-abc",
      vaultSyncDeviceId: "device-1",
      vaultSyncRootPath: "/mock/vault-root",
    });
    render(renderVaultSyncImportForm(mock), container);

    expect(container.querySelector('[data-testid="ku-space-import-vault-sync-now"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-space-import-vault-restore"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-space-import-vault-team-enable"]'),
    ).toBeTruthy();
  });

  it("pick-folder button delegates to onPickVaultSyncFolder", async () => {
    const onPickVaultSyncFolder = vi.fn(async () => undefined);
    const mock = vaultSurface({
      vaultSyncPassword: "test-passphrase",
      onPickVaultSyncFolder,
    });
    render(renderVaultSyncImportForm(mock), container);

    const pick = container.querySelector(
      '[data-testid="ku-space-import-vault-pick-folder"]',
    ) as HTMLButtonElement;
    pick.click();
    expect(onPickVaultSyncFolder).toHaveBeenCalledOnce();
  });
});
