import type { CollaborationBinding } from "@openbot/collaboration-core";

export interface BindingResolutionResult {
  found: boolean;
  binding?: CollaborationBinding;
  status?: "linked" | "stale" | "broken";
}

export interface MemberIdentityMapping {
  memberId: string;
  accountId?: string;
  status: "mapped" | "unmapped" | "ambiguous";
}

export interface DirectoryAdapter {
  resolveBinding(groupId: string, bindingId: string): Promise<BindingResolutionResult>;
  validateBinding(groupId: string, binding: CollaborationBinding): Promise<boolean>;
  mapMemberIdentity(groupId: string, memberId: string): Promise<MemberIdentityMapping>;
}
