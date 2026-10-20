/**
 * Artifact Preview Manager
 *
 * Manages preview state per artifact_id (NOT per "current file").
 *
 * Rules:
 * - Preview is always by artifact_id
 * - Multiple artifacts can be opened simultaneously (tabs)
 * - Refreshing the page restores the last active artifact
 * - The last file does NOT overwrite the current preview
 */

import { artifactRegistry } from "./registry.ts";
import type { Artifact, PreviewState } from "./types.ts";

const STORAGE_KEY = "openbot:artifact-preview-state";

export type PreviewTab = {
  artifactId: string;
  title: string;
  type: string;
  active: boolean;
};

export type PreviewManagerState = {
  tabs: PreviewTab[];
  activeArtifactId: string | null;
  activeArtifact: Artifact | null;
};

/**
 * Preview Manager — controls which artifacts are open for preview.
 */
export class ArtifactPreviewManager {
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.restoreState();
  }

  /**
   * Subscribe to preview state changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Open an artifact for preview. Does NOT close other previews.
   */
  open(artifactId: string): void {
    artifactRegistry.openPreview(artifactId);
    this.persistState();
    this.notify();
  }

  /**
   * Close a preview tab.
   */
  close(artifactId: string): void {
    artifactRegistry.closePreview(artifactId);
    this.persistState();
    this.notify();
  }

  /**
   * Switch to a different preview tab.
   */
  switchTo(artifactId: string): void {
    artifactRegistry.switchPreview(artifactId);
    this.persistState();
    this.notify();
  }

  /**
   * Get the current preview manager state for rendering.
   */
  getState(): PreviewManagerState {
    const previewState = artifactRegistry.getPreviewState();
    const tabs: PreviewTab[] = previewState.opened_artifacts.map((id) => {
      const artifact = artifactRegistry.getArtifact(id);
      return {
        artifactId: id,
        title: artifact?.title ?? "Unknown",
        type: artifact?.type ?? "doc",
        active: id === previewState.active_artifact_id,
      };
    });

    return {
      tabs,
      activeArtifactId: previewState.active_artifact_id,
      activeArtifact: artifactRegistry.getActivePreviewArtifact(),
    };
  }

  /**
   * Check if a specific artifact is currently being previewed.
   */
  isOpen(artifactId: string): boolean {
    return artifactRegistry.getPreviewState().opened_artifacts.includes(artifactId);
  }

  /**
   * Close all preview tabs.
   */
  closeAll(): void {
    const state = artifactRegistry.getPreviewState();
    for (const id of Array.from(state.opened_artifacts)) {
      artifactRegistry.closePreview(id);
    }
    this.persistState();
    this.notify();
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private persistState(): void {
    try {
      const state = artifactRegistry.getPreviewState();
      const serialized = JSON.stringify(state);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch {
      // Storage unavailable — non-critical
    }
  }

  private restoreState(): void {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const state = JSON.parse(raw) as PreviewState;
      if (state.active_artifact_id) {
        // Only restore if the artifact still exists in registry
        const artifact = artifactRegistry.getArtifact(state.active_artifact_id);
        if (artifact) {
          artifactRegistry.openPreview(state.active_artifact_id);
        }
      }
    } catch {
      // Corrupted state — ignore
    }
  }
}

/**
 * Singleton preview manager instance.
 */
export const previewManager = new ArtifactPreviewManager();
