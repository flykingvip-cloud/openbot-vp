import type { CollaborationMember } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  countParticipatingCollaborationMembers,
  isParticipatingCollaborationMember,
  resolveMembersForVacancyHeal,
  shouldAutoArchiveCollaborationSpaceWhenVacant,
  shouldHealVacantCollaborationSpaceOnList,
} from "./shared.js";

function member(partial: Partial<CollaborationMember> & Pick<CollaborationMember, "status">) {
  return {
    memberId: "m-1",
    memberKind: "human" as const,
    userId: "user-1",
    governanceRole: "member" as const,
    updatedAtMs: Date.now(),
    ...partial,
  };
}

describe("collaboration vacancy archive helpers", () => {
  it("treats active and paused members as participating", () => {
    expect(isParticipatingCollaborationMember(member({ status: "active" }))).toBe(true);
    expect(isParticipatingCollaborationMember(member({ status: "paused" }))).toBe(true);
    expect(isParticipatingCollaborationMember(member({ status: "invited" }))).toBe(false);
    expect(isParticipatingCollaborationMember(member({ status: "removed" }))).toBe(false);
  });

  it("auto-archives only when participating members drop from >0 to 0", () => {
    const active = [member({ status: "active" }), member({ memberKind: "bot", status: "active" })];
    const removed = active.map((entry) => ({ ...entry, status: "removed" as const }));

    expect(
      shouldAutoArchiveCollaborationSpaceWhenVacant({
        profile: { lifecycleStatus: "ACTIVE" } as never,
        previousMembers: active,
        nextMembers: removed,
      }),
    ).toBe(true);

    expect(
      shouldAutoArchiveCollaborationSpaceWhenVacant({
        profile: { lifecycleStatus: "archived" } as never,
        previousMembers: active,
        nextMembers: removed,
      }),
    ).toBe(false);

    expect(
      shouldAutoArchiveCollaborationSpaceWhenVacant({
        profile: null,
        previousMembers: removed,
        nextMembers: removed,
      }),
    ).toBe(false);

    expect(countParticipatingCollaborationMembers(removed)).toBe(0);
  });

  it("prefers managed mirror roster when runtime members are stale but mirror is vacant", () => {
    const active = [member({ status: "active" }), member({ memberKind: "bot", status: "active" })];
    const removed = active.map((entry) => ({ ...entry, status: "removed" as const }));

    expect(
      resolveMembersForVacancyHeal({
        runtimeMembers: active,
        managedMembers: removed,
      }),
    ).toEqual(removed);

    expect(
      shouldHealVacantCollaborationSpaceOnList({
        profile: { lifecycleStatus: "ACTIVE" } as never,
        members: removed,
      }),
    ).toBe(true);
  });
});
