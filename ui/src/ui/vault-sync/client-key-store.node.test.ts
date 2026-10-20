import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateRotatedBaseKey } from "./client-crypto.ts";
import {
  clearSealedBaseKey,
  loadMemberKeyPair,
  loadSealedBaseKey,
  saveMemberKeyPair,
  sealAndStoreBaseKey,
} from "./client-key-store.ts";

const vaultId = "vault-keystore-test";
const accountId = "owner@acme.test";

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
});

afterEach(() => {
  clearSealedBaseKey(vaultId);
  localStorage.removeItem(`openbot.vault-sync.member-keys.v1:${vaultId}:${accountId}`);
  vi.unstubAllGlobals();
});

describe("client-key-store", () => {
  it("persists member key pairs", () => {
    saveMemberKeyPair(vaultId, accountId, {
      publicKeyB64: "pk",
      privateKeyB64: "sk",
    });
    expect(loadMemberKeyPair(vaultId, accountId)).toEqual({
      publicKeyB64: "pk",
      privateKeyB64: "sk",
    });
  });

  it("seals and unseals rotated BaseKey for matching epoch", async () => {
    const baseKey = generateRotatedBaseKey();
    await sealAndStoreBaseKey({
      vaultId,
      password: "sync-password",
      baseKey,
      keyEpoch: 3,
    });
    const loaded = await loadSealedBaseKey({
      vaultId,
      password: "sync-password",
      expectedEpoch: 3,
    });
    expect(loaded?.keyEpoch).toBe(3);
    expect(loaded?.baseKey).toEqual(baseKey);
    expect(
      await loadSealedBaseKey({
        vaultId,
        password: "sync-password",
        expectedEpoch: 2,
      }),
    ).toBeNull();
    expect(
      await loadSealedBaseKey({
        vaultId,
        password: "wrong",
        expectedEpoch: 3,
      }),
    ).toBeNull();
  });
});
