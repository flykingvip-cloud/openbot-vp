import type { AppPortState } from "../../app-port-state.ts";
import { agentsCapability } from "../../capability/agents/index.ts";
import {
  spacesCapability,
  type SpacesCapabilityLeaveParams,
  type SpacesCapabilityResetParams,
  type SpacesCapabilityDissolveParams,
  type SpacesCapabilityTransferOwnershipParams,
  type SpacesCapabilityUpdateMembersParams,
} from "../../capability/spaces/index.ts";
import {
  adaptAgentsLoadCapabilityState,
  adaptSpacesManageCapabilityState,
} from "../../capability/view-state.ts";

export async function reloadEmployeeWorkbenchAgents(state: AppPortState) {
  await agentsCapability.load(adaptAgentsLoadCapabilityState(state));
}

export async function updateEmployeeWorkbenchSpaceMembers(
  state: AppPortState,
  payload: SpacesCapabilityUpdateMembersParams,
) {
  return await spacesCapability.updateMembers(adaptSpacesManageCapabilityState(state), payload);
}

export async function resetEmployeeWorkbenchSpace(
  state: AppPortState,
  payload: SpacesCapabilityResetParams,
) {
  return await spacesCapability.reset(adaptSpacesManageCapabilityState(state), payload);
}

export async function dissolveEmployeeWorkbenchSpace(
  state: AppPortState,
  payload: SpacesCapabilityDissolveParams,
) {
  return await spacesCapability.dissolve(adaptSpacesManageCapabilityState(state), payload);
}

export async function leaveEmployeeWorkbenchSpace(
  state: AppPortState,
  payload: SpacesCapabilityLeaveParams,
) {
  return await spacesCapability.leave(adaptSpacesManageCapabilityState(state), payload);
}

export async function transferEmployeeWorkbenchSpaceOwnership(
  state: AppPortState,
  payload: SpacesCapabilityTransferOwnershipParams,
) {
  return await spacesCapability.transferOwnership(adaptSpacesManageCapabilityState(state), payload);
}
