/**
 * Artifact Delivery Layer — Public API
 *
 * This module provides the complete Artifact Delivery system:
 * - Registry: manages all artifact objects
 * - Card: renders artifacts as interactive cards in chat
 * - Preview Manager: handles multi-artifact preview tabs
 * - Event Handler: processes artifact events from agents
 * - Persistence: saves/restores artifact state across sessions
 *
 * Architecture:
 *   Chat Layer
 *     ↓
 *   Task Layer
 *     ↓
 *   Artifact Delivery Layer (this module)
 *     ↓
 *   Preview Layer
 */

// Types
export type {
  Artifact,
  ArtifactCardProps,
  ArtifactEvent,
  ArtifactFileType,
  ArtifactKind,
  ArtifactLedger,
  ArtifactLifecycleState,
  ArtifactMetadata,
  PreviewState,
  Task,
  TaskCardProps,
} from "./types.ts";

// Registry (singleton)
export {
  ArtifactRegistry,
  artifactRegistry,
  getArtifactIcon,
  getArtifactTypeLabel,
} from "./registry.ts";
export type { CreateArtifactInput, CreateTaskInput } from "./registry.ts";

// Card rendering
export {
  renderArtifactCard,
  renderArtifactDeliveryGroup,
  renderArtifactRecoveryPrompt,
  renderTaskArtifactCard,
} from "./card.ts";

// Preview management
export { ArtifactPreviewManager, previewManager } from "./preview-manager.ts";
export type { PreviewManagerState, PreviewTab } from "./preview-manager.ts";

// Event handling
export {
  detectArtifactFileType,
  detectArtifactKind,
  detectArtifactsInMessage,
  handleArtifactEvent,
  parseArtifactEvent,
} from "./event-handler.ts";

// Persistence
export {
  clearPersistedArtifactLedger,
  initializeFromPersistedState,
  persistArtifactLedger,
  restoreArtifactLedger,
  setupAutoPersist,
} from "./persistence.ts";
