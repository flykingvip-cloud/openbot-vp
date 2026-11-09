import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemberArtifactDeliveryIdentity } from "../../policy/accepted-artifact-delivery.js";
import {
  commitMemberArtifactDeliveryAssociation,
  deliveryKeyHash,
  noteAssociationRenamedAwayFromStaged,
  recordAssociationObservation,
  recoverPartialStagedAssociation,
} from "./accepted-artifact-delivery-txn.js";

const roots: string[] = [];

async function rootDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-delivery-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function identity(
  patch: Partial<MemberArtifactDeliveryIdentity> = {},
): MemberArtifactDeliveryIdentity {
  return {
    tenantId: "ten-a",
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    actorId: "bot-b",
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: "abc",
    target: { channel: "telegram", to: "chat-1" },
    ...patch,
  };
}

describe("commitMemberArtifactDeliveryAssociation", () => {
  it("persists one non-sendable staged record for the same key", async () => {
    const root = await rootDir();
    const [first, second] = await Promise.all([
      commitMemberArtifactDeliveryAssociation({ rootDir: root, identity: identity(), nowMs: 1 }),
      commitMemberArtifactDeliveryAssociation({ rootDir: root, identity: identity(), nowMs: 2 }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.intent.keyHash).toBe(second.intent.keyHash);
    expect(first.intent.queueId).toBeNull();
    expect(first.intent.bridgeSendStarted).toBe(false);
    expect(first.intent.authorization).toBe("authorization_pending");
    const stagedDir = path.join(root, "staged");
    const names = await fs.readdir(stagedDir);
    expect(names.filter((name) => name.endsWith(".bridge-staged"))).toHaveLength(1);
    expect(names.some((name) => name.endsWith(".json"))).toBe(false);
    const top = await fs.readdir(root);
    expect(top.some((name) => name.endsWith(".json"))).toBe(false);
  });

  it("does not create another record after the staged file is renamed away", async () => {
    const root = await rootDir();
    const created = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 1,
    });
    expect(created.ok).toBe(true);
    const renamed = await noteAssociationRenamedAwayFromStaged({
      rootDir: root,
      identity: identity(),
      nowMs: 2,
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) {
      return;
    }
    expect(renamed.intent.phase).toBe("queued");
    expect(renamed.intent.queueId).toBeNull();
    const again = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 3,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) {
      return;
    }
    expect(again.created).toBe(false);
    expect(again.intent.keyHash).toBe(renamed.intent.keyHash);
    expect(again.intent.phase).toBe("queued");
    const names = await fs.readdir(path.join(root, "staged"));
    expect(names.filter((name) => name.endsWith(".bridge-staged"))).toHaveLength(0);
    expect(names.filter((name) => name.endsWith(".bridge-associated"))).toHaveLength(1);
  });

  it("keeps a half-written staged file on the same key", async () => {
    const root = await rootDir();
    const keyHash = deliveryKeyHash(identity());
    expect(keyHash).toBeTruthy();
    const staged = path.join(root, "staged", `bridge-${keyHash}.bridge-staged`);
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.writeFile(staged, "{", "utf8");
    const recovered = await recoverPartialStagedAssociation({
      rootDir: root,
      identity: identity(),
    });
    expect(recovered).toMatchObject({ ok: true, keyHash, completedFromIntent: false });
    const committed = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 4,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) {
      return;
    }
    expect(committed.intent.keyHash).toBe(keyHash);
    await fs.writeFile(staged, "{", "utf8");
    const repaired = await recoverPartialStagedAssociation({ rootDir: root, identity: identity() });
    expect(repaired).toMatchObject({ ok: true, keyHash, completedFromIntent: true });
    const intents = await fs.readdir(path.join(root, "intents"));
    expect(intents).toEqual([`${keyHash}.intent.json`]);
  });

  it("isolates tenants", async () => {
    const root = await rootDir();
    const a = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ tenantId: "ten-a" }),
      nowMs: 1,
    });
    const b = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ tenantId: "ten-b" }),
      nowMs: 1,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.intent.keyHash).not.toBe(b.intent.keyHash);
  });

  it("returns the same intent for unknown and does not treat a no-effect failure as unknown", async () => {
    const root = await rootDir();
    await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 1,
    });
    const unknownEffect = await recordAssociationObservation({
      rootDir: root,
      identity: identity(),
      phase: "failed_retryable",
      externalEffect: "unknown",
    });
    expect(unknownEffect.ok).toBe(false);
    const retryable = await recordAssociationObservation({
      rootDir: root,
      identity: identity(),
      phase: "failed_retryable",
      externalEffect: "none",
    });
    expect(retryable.ok).toBe(true);
    if (!retryable.ok) {
      return;
    }
    expect(retryable.intent.retryable).toBe(true);
    expect(retryable.intent.externalEffect).toBe("none");
    const unknown = await recordAssociationObservation({
      rootDir: root,
      identity: identity(),
      phase: "unknown",
      externalEffect: "unknown",
    });
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) {
      return;
    }
    expect(unknown.intent.retryable).toBe(false);
    const again = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 9,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) {
      return;
    }
    expect(again.created).toBe(false);
    expect(again.intent.phase).toBe("unknown");
    expect(again.intent.keyHash).toBe(unknown.intent.keyHash);
  });

  it("does not associate a group-final or unaccepted identity", async () => {
    const root = await rootDir();
    const groupFinal = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ scope: "group_final" }),
    });
    const open = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ boardStatus: "submitted_for_review" }),
    });
    expect(groupFinal).toEqual({ ok: false, reason: "group_final_not_member_artifact" });
    expect(open).toEqual({ ok: false, reason: "not_accepted" });
    await expect(fs.readdir(path.join(root, "staged"))).rejects.toThrow();
  });
});
