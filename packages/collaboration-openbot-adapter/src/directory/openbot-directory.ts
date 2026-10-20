import type { CollaborationBinding, CollaborationMember } from "@openbot/collaboration-core";
import type {
  BindingResolutionResult,
  DirectoryAdapter,
  MemberIdentityMapping,
} from "./interfaces.js";

type DirectoryFunctions = {
  loadGroupBindings: (groupId: string, baseDir?: string) => Promise<CollaborationBinding[]>;
  loadGroupMembers?: (groupId: string, baseDir?: string) => Promise<CollaborationMember[]>;
  verifyBinding: (params: {
    groupId: string;
    bindingId: string;
    baseDir?: string;
  }) => Promise<{ status?: string } | null>;
};

export class OpenBotDirectoryAdapter implements DirectoryAdapter {
  constructor(
    private readonly directoryFunctions?: DirectoryFunctions,
    private readonly baseDir?: string,
  ) {}

  async resolveBinding(groupId: string, bindingId: string): Promise<BindingResolutionResult> {
    if (!this.directoryFunctions) {
      throw new Error("Directory functions not provided");
    }
    const bindings = await this.directoryFunctions.loadGroupBindings(groupId, this.baseDir);
    const binding = bindings.find((entry) => entry.bindingId === bindingId);
    if (!binding) {
      return { found: false };
    }
    return {
      found: true,
      binding,
      status: binding.status || "linked",
    };
  }

  async validateBinding(groupId: string, binding: CollaborationBinding): Promise<boolean> {
    if (!this.directoryFunctions) {
      throw new Error("Directory functions not provided");
    }
    try {
      const result = await this.directoryFunctions.verifyBinding({
        groupId,
        bindingId: binding.bindingId,
        baseDir: this.baseDir,
      });
      return result?.status === "linked";
    } catch {
      return false;
    }
  }

  async mapMemberIdentity(groupId: string, memberId: string): Promise<MemberIdentityMapping> {
    if (!this.directoryFunctions?.loadGroupMembers) {
      return { memberId, status: "unmapped" };
    }

    const [members, bindings] = await Promise.all([
      this.directoryFunctions.loadGroupMembers(groupId, this.baseDir),
      this.directoryFunctions.loadGroupBindings(groupId, this.baseDir),
    ]);

    const member = members.find((entry) => entry.memberId === memberId);
    if (!member) {
      return { memberId, status: "unmapped" };
    }

    const candidates = Array.from(
      new Set(
        [member.userId, member.agentId, member.memberId]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim()),
      ),
    );

    const matchedBindings = bindings.filter(
      (binding) =>
        typeof binding.accountId === "string" && candidates.includes(binding.accountId.trim()),
    );

    if (matchedBindings.length === 1) {
      return {
        memberId,
        accountId: matchedBindings[0].accountId,
        status: "mapped",
      };
    }
    if (matchedBindings.length > 1) {
      return { memberId, status: "ambiguous" };
    }
    return { memberId, status: "unmapped" };
  }
}
