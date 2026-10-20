/**
 * Enterprise Mesh Governance Module
 *
 * 机巢治理重构：岗位归属 + 运营治理引擎
 */

// Types
export type {
  MeshOwnership,
  OwnershipTransferLog,
  GovernanceLevel,
  GovernanceCategory,
  GovernanceItem,
  GovernanceActionType,
  GovernanceActionParams,
  GovernanceActionResult,
  GovernanceAuditEntry,
  GovernanceConfig,
  GovernanceQueueSummary,
} from "./types.ts";
export { DEFAULT_GOVERNANCE_CONFIG } from "./types.ts";

// Ownership Service
export {
  resolveOwnershipOnCreate,
  resolveOwnershipOnImport,
  transferOwnershipOnPositionChange,
} from "./ownership-service.ts";
export type {
  CreateOwnershipParams,
  ImportOwnershipParams,
  TransferOwnershipParams,
  OwnedAsset,
  TransferResult,
} from "./ownership-service.ts";

// Ownership Migration
export { migrateAgentOwnership, migrateGroupOwnership } from "./ownership-migration.ts";
export type {
  PositionLookupEntry,
  LegacyAgentData,
  LegacyGroupData,
} from "./ownership-migration.ts";

// Governance Engine
export { detectGovernanceIssues } from "./governance-engine.ts";
export type { GovernanceAgentInput, GovernanceGroupInput } from "./governance-engine.ts";

// Governance Actions
export {
  isValidActionForLevel,
  availableActionsForLevel,
  actionLabel,
  createGovernanceActionExecutor,
  removeFromQueue,
  addToIgnored,
  filterIgnored,
} from "./governance-actions.ts";
export type { GovernanceActionExecutor } from "./governance-actions.ts";

// Governance Notification
export {
  buildCriticalNotification,
  buildEscalationNotification,
  shouldEscalate,
  hoursUnhandled,
} from "./governance-notification.ts";
export type { NotificationPayload, NotificationSender } from "./governance-notification.ts";

// Governance UI Components
export {
  GOVERNANCE_CONFIG_FIELDS,
  renderGovernanceConfigPanel,
  renderGovernanceActionDialog,
} from "./governance-ui.ts";
export type {
  GovernanceConfigField,
  GovernanceConfigPanelParams,
  GovernanceActionDialogParams,
} from "./governance-ui.ts";
