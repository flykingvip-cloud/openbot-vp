import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileKeyForTenant } from "./canonical.js";
import { ConversationTaskStoreError } from "./errors.js";
import {
  HMAC_KEY_MAX_AGE_MS,
  isHmacRotationDue,
  ShadowLogBook,
  SHADOW_LOG_DEFAULT_TTL_MS,
  tenantFingerprint,
  verifyShadowReceipt,
  type ShadowLogBookOptions,
  type TenantHmacKey,
} from "./shadow.js";
import { emptyTaskSignals, type ShadowDecisionLog } from "./types.js";

const LOG: ShadowDecisionLog = {
  shadowOnly: true,
  decisionVersion: "ct-decision-2026-08-24",
  inputFingerprint: "fp_placeholder",
  detected: true,
  confidence: "high",
  qualification: "chat",
  signals: emptyTaskSignals(),
  sideEffect: "none",
  authorization: "none",
  reasonCodes: [],
  atMs: 0,
};

const KEY_V1: TenantHmacKey = { keyId: "k1", secret: "secret-one", issuedAtMs: 0 };
const KEY_V2: TenantHmacKey = {
  keyId: "k2",
  secret: "secret-two",
  issuedAtMs: HMAC_KEY_MAX_AGE_MS,
};

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-shadow-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function book(
  over: Partial<ShadowLogBookOptions> = {},
  now: () => number = () => 1_000,
): ShadowLogBook {
  return new ShadowLogBook({
    tenantId: "tenant-a",
    storeRoot: root,
    keyProvider: () => KEY_V1,
    now,
    ...over,
  });
}

describe("tenantFingerprint — keyed HMAC (O4)", () => {
  it("is deterministic, hides raw text, is tenant-scoped, breaks on rotation", () => {
    const text = "发送给全部销售的季度报告";
    const fp = tenantFingerprint(text, "tenant-a", KEY_V1);
    expect(fp).toBe(tenantFingerprint(text, "tenant-a", KEY_V1));
    expect(fp.startsWith("hf_k1_")).toBe(true);
    expect(fp).not.toContain(text);
    expect(tenantFingerprint(text, "tenant-a", KEY_V1)).not.toBe(
      tenantFingerprint(text, "tenant-b", KEY_V1),
    );
    expect(tenantFingerprint(text, "tenant-a", KEY_V1)).not.toBe(
      tenantFingerprint(text, "tenant-a", KEY_V2),
    );
  });
});

describe("isHmacRotationDue (<= 90 days)", () => {
  it("is due at/after the max age and not before", () => {
    expect(isHmacRotationDue(KEY_V1, HMAC_KEY_MAX_AGE_MS - 1)).toBe(false);
    expect(isHmacRotationDue(KEY_V1, HMAC_KEY_MAX_AGE_MS)).toBe(true);
  });
});

describe("ShadowLogBook — persistence (P1-6)", () => {
  it("persists logs across a reopen (survives restart)", () => {
    const b1 = book();
    b1.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    b1.append({ conversationId: "c1", messageId: "m2", text: "y", log: LOG });
    expect(b1.size()).toBe(2);
    b1.close();

    const b2 = book(); // reopen same tenant + root
    expect(b2.size()).toBe(2);
    expect(b2.find("c1")).toHaveLength(2);
    b2.close();
  });

  it("stores the keyed fingerprint, not raw text", () => {
    const b = book();
    const rec = b.append({ conversationId: "c1", messageId: "m1", text: "机密内容", log: LOG });
    expect(rec.fingerprint.startsWith("hf_k1_")).toBe(true);
    expect(JSON.stringify(b.find("c1"))).not.toContain("机密内容");
    b.close();
  });
});

describe("ShadowLogBook — expired HMAC key rejects writes (P1-6)", () => {
  it("fails closed when the key is past its rotation age", () => {
    // Key issued at 0; now is beyond the 90-day max age => rotation due => reject.
    const b = book(
      { keyProvider: () => ({ keyId: "old", secret: "s", issuedAtMs: 0 }) },
      () => HMAC_KEY_MAX_AGE_MS + 1,
    );
    expect(() => b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG })).toThrow(
      ConversationTaskStoreError,
    );
    expect(() => b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG })).toThrow(
      /hmac_key_expired/,
    );
    b.close();
  });
});

describe("ShadowLogBook — TTL prune (persistent)", () => {
  it("prunes only expired records", () => {
    let now = 1_000;
    const b = book({}, () => now);
    b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    now = 1_000 + SHADOW_LOG_DEFAULT_TTL_MS - 1;
    expect(b.pruneExpired()).toBe(0);
    now = 1_000 + SHADOW_LOG_DEFAULT_TTL_MS + 1;
    expect(b.pruneExpired()).toBe(1);
    expect(b.size()).toBe(0);
    b.close();
  });

  it("honors a lowered per-tenant TTL", () => {
    let now = 0;
    const b = book({ ttlMs: 1_000 }, () => now);
    b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    now = 1_001;
    expect(b.pruneExpired()).toBe(1);
    b.close();
  });
});

describe("ShadowLogBook — tamper-evident chained deletion receipts (P1-6)", () => {
  it("produces HMAC-keyed receipts that verify, resist tampering, and chain", () => {
    const b = book();
    b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    b.append({ conversationId: "c1", messageId: "m2", text: "y", log: LOG });
    b.append({ conversationId: "c2", messageId: "m3", text: "z", log: LOG });

    const r1 = b.deleteByConversation("c1");
    expect(r1.removed).toBe(2);
    expect(r1.tenantKey).toBe(fileKeyForTenant("tenant-a"));
    expect(r1.tenantKey).not.toContain("tenant-a");

    // Keyed digest verifies with the right key.
    expect(verifyShadowReceipt(r1, KEY_V1)).toBe(true);
    // Tampering with a field breaks verification.
    expect(verifyShadowReceipt({ ...r1, removed: 99 }, KEY_V1)).toBe(false);
    // A different secret cannot reproduce the digest (keyed, not plain hash).
    expect(verifyShadowReceipt(r1, { keyId: "k1", secret: "WRONG", issuedAtMs: 0 })).toBe(false);

    // Chain: the next receipt's prevDigest is the previous receipt's digest.
    const r2 = b.deleteByTenant();
    expect(r2.prevDigest).toBe(r1.digest);
    expect(verifyShadowReceipt(r2, KEY_V1)).toBe(true);
    b.close();
  });

  it("persists receipts across a reopen", () => {
    const b1 = book();
    b1.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    b1.deleteByConversation("c1");
    b1.close();

    const b2 = book();
    const receipts = b2.listReceipts();
    expect(receipts).toHaveLength(1);
    expect(verifyShadowReceipt(receipts[0], KEY_V1)).toBe(true);
    b2.close();
  });
});

describe("ShadowLogBook — composite idempotency + no plaintext ids (C2/AC4)", () => {
  it("dedupes same (conv,msg,decisionVersion,key): one row, inserted flag flips", () => {
    const b = book();
    const r1 = b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    const r2 = b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);
    expect(r2.id).toBe(r1.id);
    expect(b.size()).toBe(1);
    b.close();
  });

  it("key rotation is a new epoch: re-inserts under the new key_id", () => {
    let key: TenantHmacKey = KEY_V1;
    const b = book({ keyProvider: () => key });
    b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    expect(b.size()).toBe(1);
    key = { keyId: "k1b", secret: "secret-1b", issuedAtMs: 900 }; // fresh, different keyId
    const r = b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG });
    expect(r.inserted).toBe(true);
    expect(b.size()).toBe(2);
    b.close();
  });

  it("persists no plaintext conversation/message ids (only keyed HMAC columns)", () => {
    const b = book();
    b.append({ conversationId: "conv-secret", messageId: "msg-secret", text: "x", log: LOG });
    const dump = JSON.stringify(b.find("conv-secret"));
    expect(dump).not.toContain("conv-secret");
    expect(dump).not.toContain("msg-secret");
    b.close();
  });
});

describe("ShadowLogBook — no unkeyed fingerprint persisted (C1/AC3)", () => {
  it("overwrites inputFingerprint with the keyed fingerprint; no fp_ in the record", () => {
    const b = book();
    // LOG.inputFingerprint is the unkeyed placeholder "fp_placeholder".
    b.append({ conversationId: "c1", messageId: "m1", text: "机密", log: LOG });
    const dump = JSON.stringify(b.find("c1"));
    expect(dump).not.toContain("fp_"); // no unkeyed fingerprint persisted
    expect(dump).toContain("hf_k1_"); // keyed fingerprint present
    b.close();
  });
});

describe("ShadowLogBook — missing key fails closed (C5/AC3)", () => {
  it("provider throwing (missing key) => no write, no degrade", () => {
    const b = book({
      keyProvider: () => {
        throw new Error("no key for tenant");
      },
    });
    expect(() =>
      b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG }),
    ).toThrow();
    expect(b.size()).toBe(0);
    b.close();
  });

  it("empty secret => refused (never degrades to unkeyed)", () => {
    const b = book({ keyProvider: () => ({ keyId: "k", secret: "", issuedAtMs: 0 }) });
    expect(() => b.append({ conversationId: "c1", messageId: "m1", text: "x", log: LOG })).toThrow(
      /hmac_key_missing/,
    );
    expect(b.size()).toBe(0);
    b.close();
  });
});
