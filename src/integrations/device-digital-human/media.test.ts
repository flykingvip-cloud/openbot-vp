import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DeviceDhError } from "./errors.js";
import { inspectImage } from "./image.js";
import { pullMedia } from "./media.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "examples", "fixtures");
const framePng = readFileSync(path.join(fixtureDir, "frame.png"));
const frameJpeg = readFileSync(path.join(fixtureDir, "frame.jpg"));

const truncatedPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const headerOnlyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xd9,
]);

function codeOf(error: unknown): string | undefined {
  return error instanceof DeviceDhError ? error.code : undefined;
}

async function listenHttp(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("media test server did not bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}/frame`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("device digital-human media checks", () => {
  it("rejects a truncated PNG fixture and a header-only JPEG", () => {
    expect(codeOf(catchInspect(truncatedPng))).toBe("MEDIA_INVALID");
    expect(codeOf(catchInspect(headerOnlyJpeg))).toBe("MEDIA_INVALID");
    expect(inspectImage(framePng, 2_000_000, 8_000_000)).toEqual({
      contentType: "image/png",
      width: 1,
      height: 1,
    });
    expect(inspectImage(frameJpeg, 2_000_000, 8_000_000)).toEqual({
      contentType: "image/jpeg",
      width: 1,
      height: 1,
    });
  });

  it("rejects an oversized stream that omits Content-Length", async () => {
    let writes = 0;
    const server = await listenHttp((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(1024, 9);
      const write = () => {
        if (res.destroyed || res.writableEnded) {
          return;
        }
        if (writes >= 64) {
          res.end();
          return;
        }
        writes += 1;
        if (res.write(chunk)) {
          setImmediate(write);
        } else {
          res.once("drain", write);
        }
      };
      write();
    });
    try {
      const error = await pullMedia(server.url, {
        allowOrigins: [],
        maxBytes: 1500,
        maxPixels: 8_000_000,
        timeoutMs: 2_000,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(codeOf(error)).toBe("MEDIA_INVALID");
      expect(writes).toBeLessThan(64);
    } finally {
      await server.close();
    }
  });

  it("cancels a chunked body once it passes the byte cap", async () => {
    let chunksSent = 0;
    const server = net.createServer((socket) => {
      let header = "";
      socket.on("data", (buf) => {
        header += buf.toString("utf8");
        if (!header.includes("\r\n\r\n") || chunksSent > 0) {
          return;
        }
        socket.on("error", () => {
          socket.destroy();
        });
        socket.write(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
        );
        const payload = Buffer.alloc(800, 4);
        const send = () => {
          if (socket.destroyed) {
            return;
          }
          if (chunksSent >= 20) {
            socket.end("0\r\n\r\n");
            return;
          }
          chunksSent += 1;
          socket.write(`${payload.length.toString(16)}\r\n`);
          socket.write(payload);
          socket.write("\r\n");
          setImmediate(send);
        };
        send();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("chunked server did not bind");
    }
    try {
      const error = await pullMedia(`http://127.0.0.1:${address.port}/chunked`, {
        allowOrigins: [],
        maxBytes: 1000,
        maxPixels: 8_000_000,
        timeoutMs: 2_000,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(codeOf(error)).toBe("MEDIA_INVALID");
      expect(chunksSent).toBeLessThan(20);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects Content-Length over the cap before buffering the body", async () => {
    let bodyWritten = false;
    const server = await listenHttp((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": "8000",
      });
      res.flushHeaders();
      setTimeout(() => {
        if (res.destroyed || res.writableEnded) {
          return;
        }
        bodyWritten = true;
        res.end(Buffer.alloc(8000, 1));
      }, 400);
    });
    try {
      const started = Date.now();
      const error = await pullMedia(server.url, {
        allowOrigins: [],
        maxBytes: 100,
        maxPixels: 8_000_000,
        timeoutMs: 2_000,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(codeOf(error)).toBe("MEDIA_INVALID");
      expect(Date.now() - started).toBeLessThan(300);
      expect(bodyWritten).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("times out a slow media response", async () => {
    const server = await listenHttp(() => {
      // Hold the response until the caller aborts.
    });
    try {
      const error = await pullMedia(server.url, {
        allowOrigins: [],
        maxBytes: 1000,
        maxPixels: 8_000_000,
        timeoutMs: 40,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(DeviceDhError);
      expect(codeOf(error)).toBe("TIMEOUT");
      expect(error instanceof DeviceDhError && error.retryable).toBe(true);
    } finally {
      await server.close();
    }
  });
});

function catchInspect(bytes: Buffer): unknown {
  try {
    return inspectImage(bytes, 2_000_000, 8_000_000);
  } catch (error) {
    return error;
  }
}
