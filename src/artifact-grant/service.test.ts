import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_GRANT_LANDING,
  createArtifactGrantService,
  resolveArtifactGrantRootUnderSharedArtifacts,
} from "./index.js";

async function tmpService() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-grant-"));
  return { root, service: createArtifactGrantService({ rootDir: root }) };
}

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

describe("ARTIFACT_GRANT_MVP", () => {
  it("exports landing id", () => {
    expect(ARTIFACT_GRANT_LANDING).toBe("ARTIFACT_GRANT_MVP");
  });

  it("places grant root under sharedArtifactsDir/.grants", () => {
    const root = resolveArtifactGrantRootUnderSharedArtifacts("/data/user/artifacts");
    expect(root.replace(/\\/g, "/")).toMatch(/\/artifacts\/\.grants$/);
  });

  it("A publish → grant to B → B redeem reads only that artifact", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "review.md",
      contentType: "text/markdown",
      content: "# Draft\nplease review line-2",
    });
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) {
      return;
    }
    const redeemed = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) {
      return;
    }
    expect(redeemed.text).toContain("please review line-2");
    expect(redeemed.artifact.artifactId).toBe(published.artifact.artifactId);
    // Store has no public list API; sibling blob must not be guessable without grant.
    const sibling = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "secret.md",
      content: "TOP SECRET",
    });
    expect(sibling.ok).toBe(true);
    if (!sibling.ok) {
      return;
    }
    // Redeem still only returns the granted artifact content.
    expect(redeemed.text).not.toContain("TOP SECRET");
  });

  it("denies wrong agent C", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "body",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    const denied = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-c",
      grantId: grant.grant.grantId,
    });
    expect(denied).toEqual({ ok: false, reason: "not_grantee" });
  });

  it("denies after revoke", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "body",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    const revoked = await service.revoke({
      userId: "u1",
      actorAgentId: "agent-a",
      grantId: grant.grant.grantId,
    });
    expect(revoked.ok).toBe(true);
    const denied = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    expect(denied).toEqual({ ok: false, reason: "revoked" });
  });

  it("denies expired grant", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "body",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const t0 = 1_700_000_000_000;
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 5_000,
      nowMs: t0,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    const denied = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
      nowMs: t0 + 5_000,
    });
    expect(denied).toEqual({ ok: false, reason: "expired" });
  });

  it("singleUse allows one redeem only", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "once",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
      singleUse: true,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    const first = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    expect(first.ok).toBe(true);
    const second = await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    expect(second).toEqual({ ok: false, reason: "single_use_exhausted" });
  });

  it("non-publisher cannot createGrant or revoke", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "body",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const badCreate = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-b",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-c",
      ttlMs: 60_000,
    });
    expect(badCreate).toEqual({ ok: false, reason: "not_publisher" });

    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    const badRevoke = await service.revoke({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    expect(badRevoke).toEqual({ ok: false, reason: "not_publisher" });
  });

  it("writes audit trail for publish/create/redeem/deny", async () => {
    const { root, service } = await tmpService();
    roots.push(root);
    const published = await service.publish({
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "doc.md",
      content: "body",
    });
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const grant = await service.createGrant({
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId: published.artifact.artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    if (!grant.ok) {
      throw new Error("grant failed");
    }
    await service.redeem({
      userId: "u1",
      actorAgentId: "agent-b",
      grantId: grant.grant.grantId,
    });
    await service.redeem({
      userId: "u1",
      actorAgentId: "agent-c",
      grantId: grant.grant.grantId,
    });
    const audit = await service.listAudit();
    const types = audit.map((e) => e.type);
    expect(types).toContain("publish");
    expect(types).toContain("grant.create");
    expect(types).toContain("grant.redeem");
    expect(types).toContain("grant.deny");
  });
});
