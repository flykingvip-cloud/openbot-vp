import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemberArtifactDeliveryIdentity } from "../../policy/accepted-artifact-delivery.js";
import {
  commitMemberArtifactDeliveryAssociation,
  deliveryKeyHash,
  noteAssociationRenamedAwayFromStaged,
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
    expect(renamed.intent.phase).toBe("associated");
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
    expect(again.intent.phase).toBe("associated");
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

  it("does not rebuild a corrupt intent or roll a terminal phase back", async () => {
    const root = await rootDir();
    const created = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const intentFile = path.join(root, "intents", `${created.intent.keyHash}.intent.json`);
    const corrupt = "{";
    await fs.writeFile(intentFile, corrupt, "utf8");
    const rebuilt = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 2,
    });
    expect(rebuilt).toEqual({ ok: false, reason: "intent_corrupt" });
    expect(await fs.readFile(intentFile, "utf8")).toBe(corrupt);

    const delivered = {
      ...created.intent,
      phase: "delivered",
      authorization: "allow",
      queueId: "queue-kept",
      externalEffect: "acknowledged",
      retryable: false,
      receiptMessageIds: ["m-1"],
    };
    await fs.writeFile(intentFile, `${JSON.stringify(delivered)}\n`, "utf8");
    const before = await fs.readFile(intentFile, "utf8");
    const kept = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 3,
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) {
      return;
    }
    expect(kept.intent.phase).toBe("delivered");
    expect(kept.intent.receiptMessageIds).toEqual(["m-1"]);
    expect(await fs.readFile(intentFile, "utf8")).toBe(before);

    const unknown = {
      ...delivered,
      phase: "unknown",
      bridgeSendStarted: true,
      externalEffect: "unknown",
      retryable: false,
    };
    await fs.writeFile(intentFile, `${JSON.stringify(unknown)}\n`, "utf8");
    const unknownBytes = await fs.readFile(intentFile, "utf8");
    const stillUnknown = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 4,
    });
    expect(stillUnknown.ok).toBe(true);
    if (!stillUnknown.ok) {
      return;
    }
    expect(stillUnknown.intent.phase).toBe("unknown");
    expect(stillUnknown.intent.retryable).toBe(false);
    expect(await fs.readFile(intentFile, "utf8")).toBe(unknownBytes);
  });

  it("refuses the rename when both association files are missing", async () => {
    const root = await rootDir();
    const created = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    await fs.rm(path.join(root, "staged"), { recursive: true, force: true });
    const renamed = await noteAssociationRenamedAwayFromStaged({
      rootDir: root,
      identity: identity(),
      nowMs: 2,
    });
    expect(renamed).toEqual({ ok: false, reason: "association_files_missing" });
    const raw = await fs.readFile(
      path.join(root, "intents", `${created.intent.keyHash}.intent.json`),
      "utf8",
    );
    expect(JSON.parse(raw).phase).toBe("staged");
  });

  it("does not share a key when fields contain separators", async () => {
    const root = await rootDir();
    const left = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ tenantId: "a\nb", groupId: "c" }),
      nowMs: 1,
    });
    const right = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ tenantId: "a", groupId: "b\nc" }),
      nowMs: 1,
    });
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect(left.intent.keyHash).not.toBe(right.intent.keyHash);
    expect(deliveryKeyHash(identity({ tenantId: "a\nb", groupId: "c" }))).not.toBe(
      deliveryKeyHash(identity({ tenantId: "a", groupId: "b\nc" })),
    );
  });

  it("rejects an incomplete intent and an identity that does not match the key", async () => {
    const root = await rootDir();
    const keyHash = deliveryKeyHash(identity());
    expect(keyHash).toBeTruthy();
    const intentFile = path.join(root, "intents", `${keyHash}.intent.json`);
    await fs.mkdir(path.dirname(intentFile), { recursive: true });
    const shallow = JSON.stringify({ version: 1, keyHash, phase: "staged" });
    await fs.writeFile(intentFile, shallow, "utf8");
    const rejected = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity(),
      nowMs: 1,
    });
    expect(rejected).toEqual({ ok: false, reason: "intent_corrupt" });
    expect(await fs.readFile(intentFile, "utf8")).toBe(shallow);

    const created = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ itemId: "item-2" }),
      nowMs: 2,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const mismatchedFile = path.join(root, "intents", `${created.intent.keyHash}.intent.json`);
    const mismatched = { ...created.intent, tenantId: "ten-other" };
    const mismatchedBytes = `${JSON.stringify(mismatched)}\n`;
    await fs.writeFile(mismatchedFile, mismatchedBytes, "utf8");
    const inconsistent = await commitMemberArtifactDeliveryAssociation({
      rootDir: root,
      identity: identity({ itemId: "item-2" }),
      nowMs: 3,
    });
    expect(inconsistent).toEqual({ ok: false, reason: "intent_corrupt" });
    expect(await fs.readFile(mismatchedFile, "utf8")).toBe(mismatchedBytes);
  });

  it("does not recreate a staged file after the association is retained", async () => {
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
    const recovered = await recoverPartialStagedAssociation({
      rootDir: root,
      identity: identity(),
    });
    expect(recovered).toMatchObject({ ok: true, completedFromIntent: false });
    const names = await fs.readdir(path.join(root, "staged"));
    expect(names.some((name) => name.endsWith(".bridge-staged"))).toBe(false);
    expect(names.some((name) => name.endsWith(".bridge-associated"))).toBe(true);

    await fs.rm(path.join(root, "staged"), { recursive: true, force: true });
    const missing = await recoverPartialStagedAssociation({ rootDir: root, identity: identity() });
    expect(missing).toEqual({ ok: false, reason: "association_file_missing" });
    const intentRaw = await fs.readFile(
      path.join(root, "intents", `${deliveryKeyHash(identity())}.intent.json`),
      "utf8",
    );
    expect(JSON.parse(intentRaw).phase).toBe("associated");
    await expect(fs.readdir(path.join(root, "staged"))).rejects.toThrow();
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
