import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactGrantHandlers,
  bindArtifactGrantServiceForTests,
  resetArtifactGrantServicesForTests,
} from "./artifact-grant.js";
import { artifactGrantPack } from "./artifact-grant.pack.js";

const tmpRoots: string[] = [];

afterEach(async () => {
  resetArtifactGrantServicesForTests();
  while (tmpRoots.length) {
    const root = tmpRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

function invoke(method: keyof typeof artifactGrantHandlers, params: Record<string, unknown>) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: unknown }>((resolve) => {
    const handler = artifactGrantHandlers[method];
    void handler({
      req: { jsonrpc: "2.0", method, params, id: "1" } as never,
      params,
      client: null,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({ ok, payload, error });
      },
      context: {} as never,
    });
  });
}

describe("artifact-grant gateway pack", () => {
  it("registers expected methods", () => {
    expect(artifactGrantPack.id).toBe("artifact-grant");
    expect(artifactGrantPack.methods).toEqual(
      expect.arrayContaining([
        "artifact.publish",
        "artifact.grant.create",
        "artifact.grant.redeem",
        "artifact.grant.revoke",
        "artifact.grant.get",
      ]),
    );
  });

  it("runs publish → grant → redeem → wrong agent deny via handlers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ag-handler-"));
    tmpRoots.push(root);
    bindArtifactGrantServiceForTests("u1", root);

    const published = await invoke("artifact.publish", {
      userId: "u1",
      publisherAgentId: "agent-a",
      name: "r.md",
      contentType: "text/markdown",
      content: "review-me",
    });
    expect(published.ok).toBe(true);
    const artifactId = (published.payload as { artifact: { artifactId: string } }).artifact
      .artifactId;

    const granted = await invoke("artifact.grant.create", {
      userId: "u1",
      publisherAgentId: "agent-a",
      artifactId,
      granteeAgentId: "agent-b",
      ttlMs: 60_000,
    });
    expect(granted.ok).toBe(true);
    const grantId = (granted.payload as { grant: { grantId: string } }).grant.grantId;

    const okRedeem = await invoke("artifact.grant.redeem", {
      userId: "u1",
      actorAgentId: "agent-b",
      grantId,
    });
    expect(okRedeem.ok).toBe(true);
    expect((okRedeem.payload as { text: string }).text).toBe("review-me");

    const bad = await invoke("artifact.grant.redeem", {
      userId: "u1",
      actorAgentId: "agent-c",
      grantId,
    });
    expect(bad.ok).toBe(false);
    expect((bad.payload as { reason: string }).reason).toBe("not_grantee");
  });
});
