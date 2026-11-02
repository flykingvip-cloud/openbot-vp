/**
 * FT-IDENTITY-PRINCIPAL-SYNC — synthetic acceptance for shared principal
 * resolution + activate sync-before-handoff order + revoke race.
 * Does not touch SA / allowlists / LIVE.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import {
  isMappedDeliveryIdentity,
  resolveTrustedPrincipalAliases,
  trustedPrincipalMatches,
} from "./delivery-actor-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const UUID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
const EMAIL = "daniel.hhd@gmail.com";
const OTHER_OWNER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("FT-IDENTITY-PRINCIPAL-SYNC acceptance", () => {
  const tempDirs: string[] = [];
  const prevStateDir = process.env.OPENBOT_STATE_DIR;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("A: same auth identity UUID/email passes shared principal resolution", () => {
    const aliases = resolveTrustedPrincipalAliases({
      actor: EMAIL,
      trustedAuthSubjects: [UUID, EMAIL],
      roster: [{ memberId: `human:${UUID}`, userId: UUID }],
    });
    expect(trustedPrincipalMatches(UUID, aliases)).toBe(true);
    expect(trustedPrincipalMatches(`human:${EMAIL}`, aliases)).toBe(true);
    expect(
      isMappedDeliveryIdentity({ memberRoleMap: [{ memberId: `human:${UUID}` }] }, EMAIL, null, {
        trustedAuthSubjects: [UUID, EMAIL],
        roster: [{ memberId: `human:${UUID}`, userId: UUID }],
      }),
    ).toBe(true);
  });

  it("B1: forged alias without trusted link is rejected", () => {
    expect(
      isMappedDeliveryIdentity(
        { memberRoleMap: [{ memberId: `human:${UUID}` }] },
        "forged@evil.example",
        null,
        {
          trustedAuthSubjects: [OTHER_OWNER, "forged@evil.example"],
          roster: [{ memberId: `human:${UUID}`, userId: UUID }],
        },
      ),
    ).toBe(false);
  });

  it("B2: cross-tenant roster row does not bridge unrelated session", () => {
    const foreignUuid = "11111111-2222-3333-4444-555555555555";
    expect(
      isMappedDeliveryIdentity(
        { memberRoleMap: [{ memberId: `human:${foreignUuid}` }] },
        EMAIL,
        null,
        {
          trustedAuthSubjects: [UUID, EMAIL],
          roster: [{ memberId: `human:${foreignUuid}`, userId: foreignUuid }],
        },
      ),
    ).toBe(false);
  });

  it("B4: revoke race — targets stripped while membership surface remains → auth_revoked", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-id-sync-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const groupId = "grp-identity-revoke-race";
    const groupsRoot = path.join(root, "collaboration", "groups");
    const groupLocator = path.join(groupsRoot, groupId);
    await fs.mkdir(groupLocator, { recursive: true });

    const stores = createTrustedGroupStores({ groupsRoot, groupLocator });
    // Keep a membership surface (other owner/coord) so recheck enforces mapping;
    // victim UUID/email/bot-2 are absent → auth_revoked.
    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "operating-state.json",
      data: {
        groupId,
        memberRoleMap: [
          { memberId: `human:${OTHER_OWNER}`, status: "active" },
          { memberId: "bot:other-bot", status: "active" },
        ],
        governance: {
          ownerUserId: OTHER_OWNER,
          adminUserIds: [],
          coordinatorBotId: "other-bot",
        },
        activeContext: {},
      },
    });
    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "members.json",
      data: {
        members: [
          {
            memberId: `human:${OTHER_OWNER}`,
            userId: OTHER_OWNER,
            memberKind: "human",
            status: "active",
          },
        ],
      },
    });

    const auth = await recheckCurrentDispatchAuthorization({
      groupId,
      targetActorIds: ["bot-2", EMAIL],
      fileStore: stores.fileStore,
      objectStorage: stores.objectStorage,
      trustedAuthSubjects: [UUID, EMAIL],
    });
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.reason).toBe("auth_revoked");
      expect(auth.revokedActorIds.length).toBeGreaterThan(0);
    }
  });

  it("B4b: after sync-visible grant, same targets map; then revoke rejects (counterexample pair)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-id-sync2-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const groupId = "grp-identity-grant-then-revoke";
    const groupsRoot = path.join(root, "collaboration", "groups");
    const groupLocator = path.join(groupsRoot, groupId);
    await fs.mkdir(groupLocator, { recursive: true });
    const stores = createTrustedGroupStores({ groupsRoot, groupLocator });

    const roster = [
      {
        memberId: `human:${UUID}`,
        userId: UUID,
        memberKind: "human" as const,
        governanceRole: "owner" as const,
        status: "active" as const,
      },
      {
        memberId: "bot:bot-2",
        agentId: "bot-2",
        memberKind: "bot" as const,
        governanceRole: "member" as const,
        status: "active" as const,
      },
    ];

    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "members.json",
      data: { members: roster },
    });
    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "operating-state.json",
      data: {
        groupId,
        memberRoleMap: [
          { memberId: `human:${UUID}`, status: "active" },
          { memberId: "bot:bot-2", status: "active" },
        ],
        governance: {
          ownerUserId: UUID,
          adminUserIds: [],
          coordinatorBotId: "bot-2",
        },
        activeContext: {},
      },
    });

    const granted = await recheckCurrentDispatchAuthorization({
      groupId,
      targetActorIds: ["bot-2", EMAIL],
      fileStore: stores.fileStore,
      objectStorage: stores.objectStorage,
      trustedAuthSubjects: [UUID, EMAIL],
    });
    expect(granted.ok).toBe(true);

    // Revoke race: keep surface via unrelated owner; strip victim mapping.
    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "operating-state.json",
      data: {
        groupId,
        memberRoleMap: [
          { memberId: `human:${OTHER_OWNER}`, status: "active" },
          { memberId: "bot:other-bot", status: "active" },
        ],
        governance: {
          ownerUserId: OTHER_OWNER,
          adminUserIds: [],
          coordinatorBotId: "other-bot",
        },
        activeContext: {},
      },
    });
    await stores.fileStore.writeGroupFile({
      groupId,
      filename: "members.json",
      data: {
        members: [
          {
            memberId: `human:${OTHER_OWNER}`,
            userId: OTHER_OWNER,
            memberKind: "human",
            status: "active",
          },
        ],
      },
    });

    const revoked = await recheckCurrentDispatchAuthorization({
      groupId,
      targetActorIds: ["bot-2", EMAIL],
      fileStore: stores.fileStore,
      objectStorage: stores.objectStorage,
      trustedAuthSubjects: [UUID, EMAIL],
    });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.reason).toBe("auth_revoked");
    }
  });

  it("E5: activate syncActivated invokes syncGroupOperatingState before tryClaimAfterBoardPublish", async () => {
    const activatePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "activate-collaboration-task.ts",
    );
    const source = await fs.readFile(activatePath, "utf8");
    const syncActivated = source.indexOf("const syncActivated = async");
    expect(syncActivated).toBeGreaterThan(0);
    const syncInFn = source.indexOf("await syncGroupOperatingState({", syncActivated);
    const claimInFn = source.indexOf("await tryClaimAfterBoardPublish({", syncActivated);
    expect(syncInFn).toBeGreaterThan(syncActivated);
    expect(claimInFn).toBeGreaterThan(syncInFn);
    const failBlock = source.slice(syncInFn, claimInFn);
    expect(failBlock).toMatch(/operating_state_sync_failed/);
    expect(failBlock).not.toMatch(/tryClaimAfterBoardPublish/);
  });

  it("D: SA allowlist / self-advance flags are not modified by this package (static)", async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      "delivery-actor-binding.ts",
      "team-resource-auth.ts",
      "activate-collaboration-task.ts",
    ];
    for (const name of files) {
      const body = await fs.readFile(path.join(dir, name), "utf8");
      expect(body).not.toMatch(/selfAdvance\.executeGroupAllowlist/);
      expect(body).not.toMatch(/botMaySelfAdvanceWithoutHuman\s*=\s*true/);
    }
    const recheck = await fs.readFile(
      path.join(dir, "../collaboration-dispatch/task-dispatch-auth-recheck.ts"),
      "utf8",
    );
    expect(recheck).not.toMatch(/selfAdvance\.executeGroupAllowlist/);
    expect(recheck).not.toMatch(/botMaySelfAdvanceWithoutHuman\s*=\s*true/);
  });
});
