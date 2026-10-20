import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withAtomV2Defaults } from "../domain/atom-v2.js";
import type { MemoryAtom, Scope } from "../models.js";
import {
  InMemoryCloudIntelligenceClient,
  createCloudIdempotencyKey,
  createCloudNonce,
} from "./cloud-client.js";
import { grantPromotionConsent, revokePromotionConsent } from "./consent.js";
import { drainOutbox, nextOutboxBackoffMs } from "./drain-outbox.js";
import { enqueuePromotionOutbox } from "./enqueue-promotion.js";
import { FileSyncOutbox, InMemorySyncOutbox, resolveSyncOutboxStorePath } from "./outbox.js";
import { decidePromotion } from "./promotion-decision.js";

const scope: Scope = {
  workspaceId: "ws_p502",
  projectId: "proj_p502",
  agentId: "agent_main",
  visibility: "private",
};

function makeAtom(): MemoryAtom {
  return withAtomV2Defaults({
    id: "atm_sync_1",
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: "prefer async buffering" },
    trigger: { conditions: ["latency"], contextTags: ["ops"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["ev_1"] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.9, reuseCount: 0 },
  });
}

describe("CW2-P5-02 outbox + cloud client", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const auth = {
    tenantId: "tenant_a",
    deviceId: "device_1",
    credential: "test-credential",
  };

  it("enqueues push after consent and drains to cloud", async () => {
    const outbox = new InMemorySyncOutbox();
    const client = new InMemoryCloudIntelligenceClient();
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    const decision = decidePromotion(granted.atom);
    expect(decision.decision).toBe("ready");

    const entry = await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision,
      auth,
    });
    expect(entry?.operation).toBe("push");

    const drain = await drainOutbox({ outbox, client, auth });
    expect(drain).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(client.getPushed("atm_sync_1")?.tenantId).toBe("tenant_a");
    expect((await outbox.get(entry!.id))?.status).toBe("done");
  });

  it("revoke enqueues delete_tombstone and removes cloud object", async () => {
    const outbox = new InMemorySyncOutbox();
    const client = new InMemoryCloudIntelligenceClient();
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    await drainOutbox({ outbox, client, auth });
    expect(client.getPushed("atm_sync_1")).toBeTruthy();

    const revoked = revokePromotionConsent(granted.atom);
    const deleteEntry = await enqueuePromotionOutbox({
      outbox,
      mutation: revoked,
      decision: decidePromotion(revoked.atom, { consentRevoked: true }),
      auth,
    });
    expect(deleteEntry?.operation).toBe("delete_tombstone");
    await drainOutbox({ outbox, client, auth });
    expect(client.getPushed("atm_sync_1")).toBeUndefined();
    expect(client.getDeleted("atm_sync_1")?.tenantId).toBe("tenant_a");
  });

  it("rejects anti-replay and cross-tenant claims", async () => {
    const client = new InMemoryCloudIntelligenceClient({
      nowMs: () => 1_000_000,
      replayWindowMs: 60_000,
    });
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    const decision = decidePromotion(granted.atom);
    const envelope = decision.envelope!;
    const nonce = createCloudNonce();
    const key = createCloudIdempotencyKey({
      atomId: envelope.atomId,
      operation: "push",
      atomVersion: 1,
    });

    const stale = await client.push(
      {
        idempotencyKey: key,
        envelope,
        nonce: createCloudNonce(),
        timestampMs: 1_000_000 - 120_000,
      },
      auth,
    );
    expect(stale).toMatchObject({ ok: false, code: "ANTI_REPLAY" });

    const first = await client.push(
      { idempotencyKey: key, envelope, nonce, timestampMs: 1_000_000 },
      auth,
    );
    expect(first.ok).toBe(true);
    const replay = await client.push(
      {
        idempotencyKey: `${key}_other`,
        envelope,
        nonce,
        timestampMs: 1_000_000,
      },
      auth,
    );
    expect(replay).toMatchObject({ ok: false, code: "ANTI_REPLAY" });

    const cross = await client.push(
      {
        idempotencyKey: createCloudIdempotencyKey({
          atomId: envelope.atomId,
          operation: "push",
          atomVersion: 2,
        }),
        envelope,
        claimedTenantId: "tenant_b",
        nonce: createCloudNonce(),
        timestampMs: 1_000_000,
      },
      auth,
    );
    expect(cross).toMatchObject({ ok: false, code: "TENANT_MISMATCH" });
  });

  it("retries failed drains with backoff and preserves idempotency", async () => {
    expect(nextOutboxBackoffMs(1)).toBe(5_000);
    expect(nextOutboxBackoffMs(4)).toBe(30_000);

    const outbox = new InMemorySyncOutbox();
    const clock = { t: Date.now() };
    const client = new InMemoryCloudIntelligenceClient({
      validCredentials: ["good"],
      nowMs: () => clock.t,
    });
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    const entry = await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth: { ...auth, credential: "bad" },
    });
    // Align drain clock with wall-clock enqueue (nextAttemptAt uses real ISO now).
    clock.t = Date.now() + 1;
    const fail = await drainOutbox({
      outbox,
      client,
      auth: { ...auth, credential: "bad" },
      nowMs: clock.t,
    });
    expect(fail.failed).toBe(1);
    const failedEntry = await outbox.get(entry!.id);
    expect(failedEntry?.status).toBe("failed");
    expect(failedEntry?.nextAttemptAt).toBeTruthy();
    const nextDue = Date.parse(failedEntry!.nextAttemptAt!);

    // Not due yet
    clock.t = nextDue - 1;
    const skipped = await drainOutbox({
      outbox,
      client,
      auth: { ...auth, credential: "good" },
      nowMs: clock.t,
    });
    expect(skipped.processed).toBe(0);

    clock.t = nextDue + 1;
    const ok = await drainOutbox({
      outbox,
      client,
      auth: { ...auth, credential: "good" },
      nowMs: clock.t,
    });
    expect(ok.succeeded).toBe(1);

    // Idempotent re-drain of done entry is a no-op
    clock.t = nextDue + 12_000;
    const again = await drainOutbox({
      outbox,
      client,
      auth: { ...auth, credential: "good" },
      nowMs: clock.t,
    });
    expect(again.processed).toBe(0);
  });

  it("persists FileSyncOutbox under stateDir/cogniweave/outbox", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cw2-p502-"));
    tempDirs.push(dir);
    const outbox = new FileSyncOutbox(dir);
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    const entry = await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    expect(resolveSyncOutboxStorePath(dir)).toContain(join("cogniweave", "outbox", "store.json"));

    const reopened = new FileSyncOutbox(dir);
    expect((await reopened.get(entry!.id))?.atomId).toBe("atm_sync_1");
  });
});
