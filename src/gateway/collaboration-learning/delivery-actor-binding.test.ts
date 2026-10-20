import { describe, expect, test } from "vitest";
import {
  authenticatedSessionSubjects,
  bindDeliveryActor,
  claimedConnectActorId,
  isMappedDeliveryIdentity,
  preferMappedSessionSubjects,
} from "./delivery-actor-binding.js";

const membership = {
  governance: { coordinatorBotId: "bot-coord" },
  memberRoleMap: [{ memberId: "bot-secretary" }, { memberId: "bot-coord" }],
};

const ceoMembership = {
  governance: { coordinatorBotId: "bot" },
  memberRoleMap: [{ memberId: "daniel.hhd@gmail.com" }, { memberId: "bot" }],
};

describe("delivery actor binding", () => {
  test("connect.user is claimed and session fields are not", () => {
    expect(
      claimedConnectActorId({
        connect: { user: "bot-secretary", client: { displayName: "other", id: "cli" } },
        platformUserId: "bot-secretary",
      }),
    ).toBe("bot-secretary");
    expect(
      claimedConnectActorId({
        connect: { client: { displayName: "bot-secretary" } },
      }),
    ).toBe("bot-secretary");
  });

  test("mapped member and publisher require a matching subject", () => {
    expect(isMappedDeliveryIdentity(membership, "bot-secretary")).toBe(true);
    expect(isMappedDeliveryIdentity(membership, "bot-coord")).toBe(true);
    expect(isMappedDeliveryIdentity(null, "bot-lead", "bot-lead")).toBe(true);
    expect(isMappedDeliveryIdentity(membership, "bot-attacker")).toBe(false);

    expect(() =>
      bindDeliveryActor({
        claimedId: "bot-secretary",
        subjects: [],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);
    expect(() =>
      bindDeliveryActor({
        claimedId: "bot-secretary",
        subjects: ["other-session"],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);
    expect(
      bindDeliveryActor({
        claimedId: "bot-secretary",
        subjects: ["bot-secretary"],
        privileged: true,
      }),
    ).toBe("bot-secretary");
  });

  test("non-member connect.user is unchanged when no session subject exists", () => {
    expect(
      bindDeliveryActor({
        claimedId: "human-reviewer",
        subjects: [],
        privileged: false,
      }),
    ).toBe("human-reviewer");
  });

  test("prefers stamped email over platform UUID when email is authorized confirmer", () => {
    const subjects = authenticatedSessionSubjects({
      platformUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      user: "daniel.hhd@gmail.com",
      connect: { client: { displayName: "Chrome · Mac" } },
    });
    expect(subjects[0]).toBe("90fed19a-1c8b-4420-87e0-bcc6165e32fa");

    const preferred = preferMappedSessionSubjects({
      subjects,
      stampedUser: "daniel.hhd@gmail.com",
      state: ceoMembership,
    });
    expect(preferred[0]).toBe("daniel.hhd@gmail.com");

    const actor = bindDeliveryActor({
      claimedId: "Chrome · Mac",
      subjects: preferred,
      privileged: false,
    });
    expect(actor).toBe("daniel.hhd@gmail.com");
  });

  test("does not prefer email that is not a mapped member", () => {
    const preferred = preferMappedSessionSubjects({
      subjects: ["uuid-1", "stranger@example.com"],
      stampedUser: "stranger@example.com",
      state: ceoMembership,
    });
    expect(preferred[0]).toBe("uuid-1");
  });

  test("coordinator bot claimed id still requires matching subject", () => {
    expect(() =>
      bindDeliveryActor({
        claimedId: "bot-coord",
        subjects: ["uuid-other"],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);
    expect(
      bindDeliveryActor({
        claimedId: "bot-coord",
        subjects: ["bot-coord", "uuid-other"],
        privileged: true,
      }),
    ).toBe("bot-coord");
  });

  test("forgery: privileged claimed id rejected when session subjects mismatch", () => {
    expect(() =>
      bindDeliveryActor({
        claimedId: "daniel.hhd@gmail.com",
        subjects: ["attacker-session"],
        privileged: true,
      }),
    ).toThrow(/actor_not_authenticated/);
  });
});
