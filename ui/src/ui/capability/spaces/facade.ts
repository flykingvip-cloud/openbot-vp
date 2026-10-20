import {
  leaveWorkbenchSpace,
  loadWorkbenchSpaces,
  resetWorkbenchSpace,
  dissolveWorkbenchSpace,
  transferWorkbenchSpaceOwnership,
  updateWorkbenchSpaceMembers,
  type WorkbenchSpaceLeaveParams,
  type WorkbenchSpaceResetParams,
  type WorkbenchSpaceDissolveParams,
  type WorkbenchSpaceTransferOwnershipParams,
  type WorkbenchSpaceMembersUpdateParams,
  type WorkbenchSpacesLoadOptions,
  type WorkbenchSpacesLoadState,
  type WorkbenchSpacesManageState,
} from "../../controllers/spaces.ts";

export type SpacesCapabilityLoadState = WorkbenchSpacesLoadState;
export type SpacesCapabilityLoadOptions = WorkbenchSpacesLoadOptions;
export type SpacesCapabilityManageState = WorkbenchSpacesManageState;
export type SpacesCapabilityUpdateMembersParams = WorkbenchSpaceMembersUpdateParams;
export type SpacesCapabilityResetParams = WorkbenchSpaceResetParams;
export type SpacesCapabilityDissolveParams = WorkbenchSpaceDissolveParams;
export type SpacesCapabilityLeaveParams = WorkbenchSpaceLeaveParams;
export type SpacesCapabilityTransferOwnershipParams = WorkbenchSpaceTransferOwnershipParams;

export const spacesCapability = {
  load: loadWorkbenchSpaces,
  updateMembers: updateWorkbenchSpaceMembers,
  leave: leaveWorkbenchSpace,
  transferOwnership: transferWorkbenchSpaceOwnership,
  reset: resetWorkbenchSpace,
  dissolve: dissolveWorkbenchSpace,
} as const;
