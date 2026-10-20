/**
 * Employee-port semantic read models (Strong Separation).
 *
 * My Bots + Collaboration Group projections only — never import mesh cost/runtime fields.
 */

export {
  MY_BOT_FORBIDDEN_MESH_KEYS,
  assertNoMeshFieldsOnMyBotProjection,
  createEmptyMyBotProjection,
  mapSuccessRateToStars,
  toMyBotBriefStatus,
  type MyBotBlocksComplete,
  type MyBotBriefStatus,
  type MyBotCapabilityProjection,
  type MyBotCapabilitySource,
  type MyBotCollaborationProjection,
  type MyBotDataProjection,
  type MyBotForbiddenMeshKey,
  type MyBotGrowthProjection,
  type MyBotGrowthSource,
  type MyBotIdentityProjection,
  type MyBotListSummary,
  type MyBotPersonaProjection,
  type MyBotProjection,
} from "./my-bot-read-model.ts";

export {
  computeContributionFromSessionShare,
  createEmptyCollaborationGroupProjection,
  type CollaborationGroupBasicProjection,
  type CollaborationGroupBlocksComplete,
  type CollaborationGroupMemberProjection,
  type CollaborationGroupMissionProjection,
  type CollaborationGroupProjection,
  type CollaborationGroupRulesProjection,
} from "./collaboration-group-read-model.ts";
