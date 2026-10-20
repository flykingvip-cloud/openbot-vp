import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleVaultSyncHttpRequest,
  VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX,
} from "./http-upload-handler.js";
import { VaultSyncControlPlane } from "./store/control-plane.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.OPENBOT_VAULT_SYNC_DIR;
});

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled && !res.headersSent) {
        res.statusCode = 404;
        res.end("no");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("vault-sync-http", () => {
  it("accepts binary chunk PUT with upload token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-http-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const plane = new VaultSyncControlPlane(dir);
    const vault = plane.createVault({
      ownerAccountId: "owner@acme.test",
      saltB64: Buffer.alloc(16, 1).toString("base64"),
    });
    const device = plane.registerDevice({
      vaultId: vault.vaultId,
      deviceId: "dev-1",
      platform: "desktop",
    });
    const payload = Buffer.alloc(64, 9);
    const hash = (await import("node:crypto")).createHash("sha256").update(payload).digest("hex");
    const session = plane.createUploadSession({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      ciphertextHash: hash,
      totalSizeBytes: payload.length,
      chunkSize: payload.length,
    });
    expect(session.httpUploadToken).toBeTruthy();

    const { baseUrl, close } = await withServer(handleVaultSyncHttpRequest);
    try {
      const url = `${baseUrl}${VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX}/${encodeURIComponent(vault.vaultId)}/${encodeURIComponent(session.uploadId)}/chunks/0`;
      const okRes = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-OpenBot-Vault-Upload-Token": session.httpUploadToken!,
        },
        body: payload,
      });
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as { receivedChunkIndexes: number[] };
      expect(body.receivedChunkIndexes).toContain(0);

      const bad = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-OpenBot-Vault-Upload-Token": "wrong-token",
        },
        body: payload,
      });
      expect(bad.status).toBe(403);
    } finally {
      await close();
    }
  });
});
