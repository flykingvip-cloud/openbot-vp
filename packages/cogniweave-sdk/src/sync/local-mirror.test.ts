import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withAtomV2Defaults } from "../domain/atom-v2.js";
import type { MemoryAtom, Scope } from "../models.js";
import { InMemoryCloudIntelligenceClient } from "./cloud-client.js";
import { grantPromotionConsent, revokePromotionConsent } from "./consent.js";
import { drainOutbox } from "./drain-outbox.js";
import { enqueuePromotionOutbox } from "./enqueue-promotion.js";
import {
  FileLocalIntelligenceMirror,
  InMemoryLocalIntelligenceMirror,
  buildMirrorEtag,
  resolveLocalMirrorStorePath,
  shouldApplyMirrorItem,
} from "./local-mirror.js";
import { InMemorySyncOutbox } from "./outbox.js";
import { decidePromotion } from "./promotion-decision.js";
import { buildPromotionEnvelope } from "./promotion-envelope.js";
import { pullIntoMirror } from "./pull-mirror.js";

const scope: Scope = {
  workspaceId: "ws_p503",
  projectId: "proj_p503",
  agentId: "agent_main",
  visibility: "private",
};

function makeAtom(id = "atm_mirror_1", version = 1): MemoryAtom {
  return withAtomV2Defaults({
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: "prefer local mirror offline" },
    trigger: { conditions: ["offline"], contextTags: ["sync"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: ["evt_1"], evidenceRefs: ["ev_1"] },
    versioning: { version },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.91, reuseCount: 0 },
  });
}

describe("CW2-P5-03 local intelligence mirror", () => {
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

  it("applies conflict rules: tombstone wins, higher version wins", () => {
    const envelope = buildPromotionEnvelope(
      grantPromotionConsent(makeAtom(), { privacyLevel: "shared" }).atom,
    );
    const live = {
      kind: "live" as const,
      envelope,
      etag: buildMirrorEtag({ atomId: envelope.atomId, atomVersion: 1, kind: "live" }),
    };
    expect(shouldApplyMirrorItem(undefined, live)).toBe(true);

    const tomb = {
      kind: "tombstone" as const,
      atomId: envelope.atomId,
      atomVersion: 1,
      etag: buildMirrorEtag({ atomId: envelope.atomId, atomVersion: 1, kind: "tombstone" }),
    };
    const existingLive = {
      kind: "live" as const,
      atomId: envelope.atomId,
      tenantId: "tenant_a",
      envelope,
      etag: live.etag,
      pulledAt: new Date().toISOString(),
    };
    expect(shouldApplyMirrorItem(existingLive, tomb)).toBe(true);

    const olderLive = {
      ...live,
      envelope: { ...envelope, versioning: { version: 1 } },
    };
    const existingV2 = {
      ...existingLive,
      envelope: { ...envelope, versioning: { version: 2 } },
      etag: "etag_v2",
    };
    expect(shouldApplyMirrorItem(existingV2, olderLive)).toBe(false);
  });

  it("pulls cloud promotions into mirror for local query", async () => {
    const outbox = new InMemorySyncOutbox();
    const client = new InMemoryCloudIntelligenceClient();
    const mirror = new InMemoryLocalIntelligenceMirror({ maxAgeMs: 60_000 });
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    await drainOutbox({ outbox, client, auth });

    const pull = await pullIntoMirror({ client, mirror, auth });
    expect(pull.ok).toBe(true);
    if (!pull.ok) {
      return;
    }
    expect(pull.applied).toBe(1);

    const rows = await mirror.query({ tenantId: "tenant_a" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("live");
    if (rows[0]?.kind === "live") {
      expect(rows[0].envelope.claim.statement).toContain("local mirror");
      expect(rows[0].envelope).not.toHaveProperty("transcript");
    }
    expect((await mirror.getFreshness()).status).toBe("fresh");
  });

  it("keeps last-good mirror offline and marks stale after failed pull", async () => {
    const outbox = new InMemorySyncOutbox();
    const client = new InMemoryCloudIntelligenceClient({
      validCredentials: ["good"],
    });
    const mirror = new InMemoryLocalIntelligenceMirror({ maxAgeMs: 60_000 });
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth: { ...auth, credential: "good" },
    });
    await drainOutbox({
      outbox,
      client,
      auth: { ...auth, credential: "good" },
    });
    await pullIntoMirror({
      client,
      mirror,
      auth: { ...auth, credential: "good" },
    });
    expect((await mirror.query({ tenantId: "tenant_a" })).length).toBe(1);

    const failed = await pullIntoMirror({
      client,
      mirror,
      auth: { ...auth, credential: "bad" },
    });
    expect(failed).toMatchObject({ ok: false, preserved: true, code: "UNAUTHENTICATED" });
    expect((await mirror.query({ tenantId: "tenant_a" })).length).toBe(1);
    expect((await mirror.getFreshness()).status).toBe("stale");
  });

  it("applies cloud tombstones so revoked atoms leave retrieval", async () => {
    const outbox = new InMemorySyncOutbox();
    const client = new InMemoryCloudIntelligenceClient();
    const mirror = new InMemoryLocalIntelligenceMirror();
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    await drainOutbox({ outbox, client, auth });
    await pullIntoMirror({ client, mirror, auth });

    const revoked = revokePromotionConsent(granted.atom);
    await enqueuePromotionOutbox({
      outbox,
      mutation: revoked,
      decision: decidePromotion(revoked.atom, { consentRevoked: true }),
      auth,
    });
    await drainOutbox({ outbox, client, auth });
    await pullIntoMirror({ client, mirror, auth });

    expect(await mirror.query({ tenantId: "tenant_a" })).toEqual([]);
    const tombs = await mirror.query({ tenantId: "tenant_a", includeTombstones: true });
    expect(tombs).toHaveLength(1);
    expect(tombs[0]?.kind).toBe("tombstone");
  });

  it("rejects cross-tenant claimed pulls and scopes query by tenant", async () => {
    const client = new InMemoryCloudIntelligenceClient();
    const mirror = new InMemoryLocalIntelligenceMirror();
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    const outbox = new InMemorySyncOutbox();
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    await drainOutbox({ outbox, client, auth });

    const cross = await client.pull(
      {
        claimedTenantId: "tenant_b",
        nonce: "nonce-cross",
        timestampMs: Date.now(),
      },
      auth,
    );
    expect(cross).toMatchObject({ ok: false, code: "TENANT_MISMATCH" });

    await pullIntoMirror({ client, mirror, auth });
    expect(await mirror.query({ tenantId: "tenant_b" })).toEqual([]);
    expect(await mirror.query({ tenantId: "tenant_a", workspaceId: "ws_other" })).toEqual([]);
  });

  it("persists FileLocalIntelligenceMirror under stateDir/cogniweave/mirror", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cw2-p503-"));
    tempDirs.push(dir);
    const client = new InMemoryCloudIntelligenceClient();
    const outbox = new InMemorySyncOutbox();
    const granted = grantPromotionConsent(makeAtom(), { privacyLevel: "shared" });
    await enqueuePromotionOutbox({
      outbox,
      mutation: granted,
      decision: decidePromotion(granted.atom),
      auth,
    });
    await drainOutbox({ outbox, client, auth });

    const mirror = new FileLocalIntelligenceMirror(dir);
    await pullIntoMirror({ client, mirror, auth });
    expect(resolveLocalMirrorStorePath(dir)).toContain(join("cogniweave", "mirror", "store.json"));

    const reopened = new FileLocalIntelligenceMirror(dir);
    const rows = await reopened.query({ tenantId: "tenant_a" });
    expect(rows).toHaveLength(1);
    expect((await reopened.getFreshness()).status).toBe("fresh");
  });
});
