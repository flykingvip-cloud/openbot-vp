// @vitest-environment jsdom
import { render } from "lit";
import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import {
  renderArtifactSidebar,
  renderArtifactSidebarHeaderActions,
  renderDeliverableSaveToast,
} from "./artifact-sidebar.ts";

vi.mock("../../i18n/index.ts", () => ({
  t: (key: string) => key,
}));

function workspace(): ArtifactWorkspaceSidebar {
  return {
    artifact: {
      artifactId: "doc-1",
      artifactType: "doc" as const,
      storageClass: "inline-media" as const,
      title: "协作方案",
      provider: "artifact-event",
      createdBy: { type: "bot" as const, id: "agent-1" },
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      lifecycleState: "created" as const,
      providerMetadata: {
        previewText: "# 协作方案\n\n正文",
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

describe("artifact sidebar deliverable UX", () => {
  it("does not render the deliverable status chip", () => {
    const container = document.createElement("div");
    render(
      html`${renderArtifactSidebarHeaderActions({
        workspace: workspace(),
        deliverableSaveState: {
          artifactId: "doc-1",
          status: "captured",
        },
        onSaveDeliverable: vi.fn(),
      })}`,
      container,
    );
    expect(container.querySelector(".artifact-preview-status-chip")).toBeNull();
    expect(container.textContent ?? "").not.toContain("chat.deliverableStatusCaptured");
  });

  it("disables save when status is saved and not dirty", () => {
    const container = document.createElement("div");
    render(
      html`${renderArtifactSidebarHeaderActions({
        workspace: workspace(),
        deliverableSaveState: {
          artifactId: "doc-1",
          status: "saved",
          knowledgeBaseTitle: "Team KB",
        },
        onSaveDeliverable: vi.fn(),
      })}`,
      container,
    );
    const saveButton = container.querySelector<HTMLButtonElement>(
      ".artifact-preview-action.btn--primary",
    );
    expect(saveButton?.disabled).toBe(true);
  });

  it("enables save when saved deliverable has unsaved inline edits", () => {
    const container = document.createElement("div");
    render(
      html`${renderArtifactSidebarHeaderActions({
        workspace: workspace(),
        deliverableSaveState: {
          artifactId: "doc-1",
          status: "saved",
          knowledgeBaseTitle: "Team KB",
          dirty: true,
        },
        onSaveDeliverable: vi.fn(),
      })}`,
      container,
    );
    const saveButton = container.querySelector<HTMLButtonElement>(
      ".artifact-preview-action.btn--primary",
    );
    expect(saveButton?.disabled).toBe(false);
  });

  it("keeps header actions icon-only and reveals the label on hover", () => {
    const container = document.createElement("div");
    render(
      html`${renderArtifactSidebarHeaderActions({
        workspace: workspace(),
        onSaveDeliverable: vi.fn(),
      })}`,
      container,
    );
    const actions = [...container.querySelectorAll<HTMLElement>(".artifact-preview-action")];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.classList.contains("artifact-preview-action--icon")).toBe(true);
      expect(action.getAttribute("aria-label")).toBeTruthy();
      expect(action.getAttribute("title")).toBeNull();
      expect(action.querySelector(".artifact-preview-action__label")).not.toBeNull();
    }
    const save = container.querySelector<HTMLButtonElement>(
      ".artifact-preview-action.btn--primary",
    );
    save?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    expect(save?.classList.contains("is-tip-open")).toBe(true);
  });

  it("enters inline edit for markdown article previews", () => {
    const container = document.createElement("div");
    container.className = "sidebar-panel";
    const articleWorkspace = workspace();
    articleWorkspace.artifact.mimeType = "text/markdown";
    articleWorkspace.artifact.providerMetadata = {
      ...articleWorkspace.artifact.providerMetadata,
      workspaceFilename: "论文分析.md",
      previewText: "# 协作方案\n\n正文",
    };
    render(
      html`
        ${renderArtifactSidebarHeaderActions({ workspace: articleWorkspace })}
        ${renderArtifactSidebar({ workspace: articleWorkspace })}
      `,
      container,
    );
    expect(container.querySelector(".artifact-preview-article")).not.toBeNull();
    expect(container.querySelector(".artifact-preview-text__editor")).not.toBeNull();
    const editButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "chat.editArtifact",
    );
    expect(editButton).toBeTruthy();
    editButton?.click();
    const previewText = container.querySelector<HTMLElement>(".artifact-preview-text");
    expect(previewText?.dataset.editing).toBe("1");
  });

  it("keeps the preview pane inspect-only without a nested conversation composer", () => {
    const container = document.createElement("div");
    render(renderArtifactSidebar({ workspace: workspace() }), container);
    expect(container.querySelector(".artifact-edit")).toBeNull();
    expect(container.querySelector(".artifact-preview-text")).not.toBeNull();
  });

  it("renders overwrite, save-as, and cancel as sibling actions", () => {
    const container = document.createElement("div");
    const onOverwrite = vi.fn();
    const onSaveAs = vi.fn();
    const onCancel = vi.fn();
    render(
      html`${renderArtifactSidebar({
        workspace: workspace(),
        deliverableSaveState: {
          artifactId: "doc-1",
          status: "saved",
          pendingDecision: {
            kind: "require_decision",
            suggestedSaveAsFilename: "brief-v2.md",
          },
          saveAsFilenameDraft: "brief-v2.md",
        },
        onConfirmDeliverableOverwrite: onOverwrite,
        onConfirmDeliverableSaveAs: onSaveAs,
        onCancelDeliverableSaveDecision: onCancel,
      })}`,
      container,
    );
    const panel = container.querySelector('[data-testid="deliverable-save-decision"]');
    expect(panel).not.toBeNull();
    const buttons = [...(panel?.querySelectorAll("button") ?? [])].map((button) =>
      button.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(buttons).toEqual([
      "chat.deliverableSaveOverwrite",
      "chat.deliverableSaveAs",
      "chat.deliverableSaveCancel",
    ]);
    const overwrite = [...(panel?.querySelectorAll("button") ?? [])][0];
    expect(overwrite).toBeTruthy();
    overwrite.click();
    expect(onOverwrite).toHaveBeenCalledOnce();
  });

  it("renders deliverable save toast", () => {
    const container = document.createElement("div");
    render(
      html`${renderDeliverableSaveToast({
        message: "chat.deliverableStatusSavedKb",
        kind: "success",
        shownAt: Date.now(),
      })}`,
      container,
    );
    expect(
      container.querySelector('[data-testid="deliverable-save-toast"]')?.textContent,
    ).toContain("chat.deliverableStatusSavedKb");
  });

  it("iframes blob PDF URLs and does not iframe data:application/pdf", () => {
    const blobWorkspace = workspace();
    blobWorkspace.artifact.mimeType = "application/pdf";
    blobWorkspace.artifact.previewUrl = "blob:https://www.openbot.love/pdf-1";
    blobWorkspace.artifact.providerMetadata = {
      previewKind: "pdf",
      pdfPreviewUrl: "blob:https://www.openbot.love/pdf-1",
      dataUrl: "data:application/pdf;base64,AAA",
    };
    const blobContainer = document.createElement("div");
    render(html`${renderArtifactSidebar({ workspace: blobWorkspace })}`, blobContainer);
    const iframe = blobContainer.querySelector<HTMLIFrameElement>(".artifact-preview-pdf");
    expect(iframe?.getAttribute("src")).toBe("blob:https://www.openbot.love/pdf-1");

    const dataWorkspace = workspace();
    dataWorkspace.artifact.mimeType = "application/pdf";
    dataWorkspace.artifact.previewUrl = "data:application/pdf;base64,AAA";
    dataWorkspace.artifact.providerMetadata = {
      previewKind: "pdf",
      dataUrl: "data:application/pdf;base64,AAA",
    };
    const dataContainer = document.createElement("div");
    render(html`${renderArtifactSidebar({ workspace: dataWorkspace })}`, dataContainer);
    expect(dataContainer.querySelector(".artifact-preview-pdf")).toBeNull();
    expect(
      dataContainer.querySelector<HTMLAnchorElement>('[data-testid="artifact-download-primary"]')
        ?.href,
    ).toContain("data:application/pdf");
  });
});
