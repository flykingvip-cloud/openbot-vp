/**
 * Chromium team vault E2E (Wave O).
 * Covers enable team → invite → accept → sync → atomic revoke+epoch → post-rotate sync + >1MiB.
 * Does NOT claim manual Knowledge Universe UI acceptance (pick folder / form clicks).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64 } from "./bytes.ts";
import { DIRECT_PUT_MAX_BYTES } from "./client-crypto.ts";
import { createMemoryVaultDirectory } from "./client-fsa-memory.ts";
import { createMemoryPlaneGateway, MemoryVaultSyncPlane } from "./client-sync-memory-plane.ts";
import { runClientVaultSync } from "./client-sync.ts";
import {
  acceptInviteOnClient,
  createInviteOnClient,
  enableTeamOnClient,
} from "./client-team-ops.ts";
import { revokeMemberAndRotateOnClient } from "./client-team-rotation.ts";

const ownerPassword = "owner-pass-phrase";
const memberPassword = "member-pass-phrase";
const ownerAccountId = "owner@test";
const memberAccountId = "member-b@test";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("client-team Chromium E2E (Wave O scaffold)", () => {
  it("runs team invite → sync → revoke+rotate → large file without plaintext on plane", async () => {
    const plane = new MemoryVaultSyncPlane();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const vault = plane.createVault({
      ownerAccountId,
      saltB64: bytesToBase64(salt),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a" });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-b" });

    const gateway = createMemoryPlaneGateway(plane);

    await enableTeamOnClient({
      gateway,
      vaultId: vault.vaultId,
      ownerAccountId,
      password: ownerPassword,
    });
    expect(plane.listMembers(vault.vaultId)).toHaveLength(1);

    const { inviteSecret, inviteId } = await createInviteOnClient({
      gateway,
      vaultId: vault.vaultId,
      invitedByAccountId: ownerAccountId,
      password: ownerPassword,
      inviteeAccountId: memberAccountId,
    });
    const listed = await gateway.listVaultSyncInvites?.({ vaultId: vault.vaultId });
    const invite = listed?.invites?.find((row) => row.inviteId === inviteId);
    expect(invite?.inviteSaltB64).toBeTruthy();
    expect(invite?.wrappedBaseKeyB64).toBeTruthy();

    await acceptInviteOnClient({
      gateway,
      vaultId: vault.vaultId,
      inviteId,
      memberAccountId,
      inviteSecret,
      inviteSaltB64: invite!.inviteSaltB64!,
      wrappedBaseKeyB64: invite!.wrappedBaseKeyB64!,
      keyEpoch: invite!.keyEpoch ?? 1,
      password: memberPassword,
    });
    expect(plane.listMembers(vault.vaultId).filter((m) => m.status === "active")).toHaveLength(2);

    const dirA = createMemoryVaultDirectory("team-a");
    const dirB = createMemoryVaultDirectory("team-b");
    dirA.seedFile("shared/notes.md", "# team note\n");

    const pushA = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password: ownerPassword,
      directory: dirA.asDirectoryHandle(),
    });
    expect(pushA.push.uploaded).toBe(1);
    expect(pushA.push.errors).toEqual([]);

    const pullB = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-b",
      password: memberPassword,
      directory: dirB.asDirectoryHandle(),
    });
    expect(pullB.pull.applied).toBeGreaterThanOrEqual(1);
    expect(dirB.readText("shared/notes.md")).toBe("# team note\n");

    const wireBeforeRevoke = plane.wireLog.join("\n");
    expect(wireBeforeRevoke.includes("# team note")).toBe(false);
    expect(wireBeforeRevoke.includes("shared/notes.md")).toBe(false);

    const rotated = await revokeMemberAndRotateOnClient({
      gateway,
      vaultId: vault.vaultId,
      actorAccountId: ownerAccountId,
      memberAccountId,
      password: ownerPassword,
    });
    expect(rotated.keyEpoch).toBe(2);
    expect(rotated.rotatedCount).toBe(1);

    const status = await gateway.vaultSyncStatus({ vaultId: vault.vaultId });
    expect(status.encryptionVersion).toBe(2);
    const members = plane.listMembers(vault.vaultId);
    expect(members.find((m) => m.memberAccountId === memberAccountId)?.status).toBe("revoked");

    dirA.seedFile("shared/after-revoke.md", "post-rotate content");
    const big = new Uint8Array(DIRECT_PUT_MAX_BYTES + 2048);
    big.fill(11);
    dirA.seedFile("shared/large-after-revoke.bin", big);

    const pushAfter = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password: ownerPassword,
      directory: dirA.asDirectoryHandle(),
    });
    expect(pushAfter.push.uploaded).toBeGreaterThanOrEqual(2);
    expect(pushAfter.push.errors).toEqual([]);

    const wireAfter = plane.wireLog.join("\n");
    expect(wireAfter.includes("post-rotate content")).toBe(false);
    expect(wireAfter.includes("shared/after-revoke.md")).toBe(false);
  });
});
