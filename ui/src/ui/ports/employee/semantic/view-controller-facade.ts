/**
 * View-safe re-exports of controller types/values.
 *
 * Employee views must not import `ui/controllers/*` directly (boundary test).
 * Controllers remain the source of truth; this facade is the only allowed bridge.
 */

export type {
  GrowthStatusView,
  AgentTemplateListItemView,
  GrowthCapabilityGapView,
  NextGrowthActionView,
} from "../../../controllers/agent-growth.ts";
export { EMPTY_NEXT_GROWTH_ACTION } from "../../../controllers/agent-growth.ts";

export type { WorkbenchRobotHealth } from "../../../controllers/agent-runtime-health.ts";
export type { AssetIncubationLevel } from "../../../controllers/asset-incubation/types.ts";
export type { CollaborationOptionalSuggestion } from "../../../controllers/collaboration-optional-suggestions.ts";
export type { ConversationRecordView } from "../../../controllers/conversations.ts";
export type { DaibaiPendingConfirmation } from "../../../controllers/daibai.ts";
export type { DevicePairingList } from "../../../controllers/devices.ts";
export type {
  ExtractedSkillPreview,
  QuickSaveSkillFormData,
} from "../../../controllers/skill-lifecycle.ts";

export type {
  EnterpriseAgentIdentityEntry,
  UserOperationalIdentityBindingRequestSummary,
  UserOperationalIdentityContinuationSummary,
  UserOperationalIdentityNav,
  UserOperationalIdentitySnapshot,
  UserOperationalIdentityUsageEventSummary,
  UserOperationalIdentityUsageRange,
} from "../../../controllers/user-operational-identity.ts";
export {
  buildUserOperationalIdentityAddNav,
  parseUserOperationalIdentityAddProvider,
} from "../../../controllers/user-operational-identity.ts";
