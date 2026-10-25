import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type ControlUiBootstrapConfig,
} from "./control-ui-contract.js";
import { handleControlUiAvatarRequest, handleControlUiHttpRequest } from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("handleControlUiHttpRequest", () => {
  async function withControlUiRoot<T>(params: {
    indexHtml?: string;
    fn: (tmp: string) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), params.indexHtml ?? "<html></html>\n");
      return await params.fn(tmp);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  function parseBootstrapPayload(end: ReturnType<typeof makeMockHttpResponse>["end"]) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as ControlUiBootstrapConfig;
  }

  function expectNotFoundResponse(params: {
    handled: boolean;
    res: ReturnType<typeof makeMockHttpResponse>["res"];
    end: ReturnType<typeof makeMockHttpResponse>["end"];
  }) {
    expect(params.handled).toBe(true);
    expect(params.res.statusCode).toBe(404);
    expect(params.end).toHaveBeenCalledWith("Not Found");
  }

  async function runControlUiRequest(params: {
    url: string;
    method: "GET" | "HEAD" | "POST";
    rootPath: string;
    basePath?: string;
    rootKind?: "resolved" | "bundled";
    headers?: Record<string, string>;
  }) {
    const { res, setHeader, end } = makeMockHttpResponse();
    const handled = await handleControlUiHttpRequest(
      {
        url: params.url,
        method: params.method,
        ...(params.headers ? { headers: params.headers } : {}),
      } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        root: { kind: params.rootKind ?? "resolved", path: params.rootPath },
      },
    );
    return { res, setHeader, end, handled };
  }

  function headerValue(
    setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"],
    name: string,
  ): string | undefined {
    const call = setHeader.mock.calls.find(
      (entry) => String(entry[0]).toLowerCase() === name.toLowerCase(),
    );
    return call ? String(call[1]) : undefined;
  }

  function runAvatarRequest(params: {
    url: string;
    method: "GET" | "HEAD";
    resolveAvatar: Parameters<typeof handleControlUiAvatarRequest>[2]["resolveAvatar"];
    basePath?: string;
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiAvatarRequest(
      { url: params.url, method: params.method } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        resolveAvatar: params.resolveAvatar,
      },
    );
    return { res, end, handled };
  }

  async function writeAssetFile(rootPath: string, filename: string, contents: string) {
    const assetsDir = path.join(rootPath, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const filePath = path.join(assetsDir, filename);
    await fs.writeFile(filePath, contents);
    return { assetsDir, filePath };
  }

  async function withBasePathRootFixture<T>(params: {
    siblingDir: string;
    fn: (paths: { root: string; sibling: string }) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ui-root-"));
    try {
      const root = path.join(tmp, "ui");
      const sibling = path.join(tmp, params.siblingDir);
      await fs.mkdir(root, { recursive: true });
      await fs.mkdir(sibling, { recursive: true });
      await fs.writeFile(path.join(root, "index.html"), "<html>ok</html>\n");
      return await params.fn({ root, sibling });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  it("sets security headers for Control UI responses", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, setHeader } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
          },
        );
        expect(handled).toBe(true);
        expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
        const csp = setHeader.mock.calls.find((call) => call[0] === "Content-Security-Policy")?.[1];
        expect(typeof csp).toBe("string");
        expect(String(csp)).toContain("frame-ancestors 'none'");
        expect(String(csp)).toContain("script-src 'self'");
        expect(String(csp)).not.toContain("script-src 'self' 'unsafe-inline'");
      },
    });
  });

  it("does not inject inline scripts into index.html", async () => {
    const html = "<html><head></head><body>Hello</body></html>\n";
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "evil.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const served = String(end.mock.calls[0]?.[0] ?? "");
        // Ops smoke may stamp data-openbot-build-commit on <html>; that is not script injection.
        expect(served).toMatch(
          /^<html(?:\s+data-openbot-build-commit="[a-f0-9]+")?><head><\/head><body>Hello<\/body><\/html>\n$/,
        );
        expect(served).not.toContain("<script");
        expect(served).not.toContain("alert(1)");
        expect(served).not.toContain("</script><script>");
      },
    });
  });

  it("strips JS cache-bust queries from served index.html", async () => {
    const html =
      '<script type="module" crossorigin src="./assets/index-CR5cronNm9.js?v=preview-p0p1"></script>\n';
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { handled, end } = await runControlUiRequest({
          url: "/",
          method: "GET",
          rootPath: tmp,
        });
        expect(handled).toBe(true);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe(
          '<script type="module" crossorigin src="./assets/index-CR5cronNm9.js"></script>\n',
        );
      },
    });
  });

  it("returns 410 for retired overlay entry chunks", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "index-CR5cronNm8.js", 'export*from"./index-CR5cronNm9.js";\n');
        const { handled, res, end } = await runControlUiRequest({
          url: "/assets/index-CR5cronNm8.js",
          method: "GET",
          rootPath: tmp,
        });
        expect(handled).toBe(true);
        expect(res.statusCode).toBe(410);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("Gone");
      },
    });
  });

  it("includes buildCommit from OPENBOT_BUILD_SHA on bootstrap", async () => {
    const prev = process.env.OPENBOT_BUILD_SHA;
    process.env.OPENBOT_BUILD_SHA = "d06542abea832b48c4ef0ba96d428e8a922e3e3d";
    try {
      await withControlUiRoot({
        fn: async (tmp) => {
          const { res, end } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH, method: "GET" } as IncomingMessage,
            res,
            {
              root: { kind: "resolved", path: tmp },
              config: { agents: { defaults: { workspace: tmp } } },
            },
          );
          expect(handled).toBe(true);
          const parsed = parseBootstrapPayload(end) as ControlUiBootstrapConfig & {
            buildCommit?: string;
          };
          expect(parsed.buildCommit).toBe("d06542abea832b48c4ef0ba96d428e8a922e3e3d");
        },
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_BUILD_SHA;
      } else {
        process.env.OPENBOT_BUILD_SHA = prev;
      }
    }
  });

  it("stamps data-openbot-build-commit on served index.html", async () => {
    const prev = process.env.OPENBOT_BUILD_SHA;
    process.env.OPENBOT_BUILD_SHA = "d06542abea832b48c4ef0ba96d428e8a922e3e3d";
    try {
      await withControlUiRoot({
        indexHtml: "<html><head></head><body>ui</body></html>\n",
        fn: async (tmp) => {
          const { res, end } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: "/", method: "GET" } as IncomingMessage,
            res,
            {
              root: { kind: "resolved", path: tmp },
              config: { agents: { defaults: { workspace: tmp } } },
            },
          );
          expect(handled).toBe(true);
          const html = String(end.mock.calls[0]?.[0] ?? "");
          expect(html).toContain(
            'data-openbot-build-commit="d06542abea832b48c4ef0ba96d428e8a922e3e3d"',
          );
        },
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_BUILD_SHA;
      } else {
        process.env.OPENBOT_BUILD_SHA = prev;
      }
    }
  });

  it("serves bootstrap config JSON", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH, method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "</script>.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("");
        expect(parsed.assistantName).toBe("</script><script>alert(1)//");
        expect(parsed.assistantAvatar).toBe("/avatar/main");
        expect(parsed.assistantAgentId).toBe("main");
      },
    });
  });

  it("serves bootstrap config JSON under basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`, method: "GET" } as IncomingMessage,
          res,
          {
            basePath: "/openclaw",
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "Ops", avatar: "ops.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("/openclaw");
        expect(parsed.assistantName).toBe("Ops");
        expect(parsed.assistantAvatar).toBe("/openclaw/avatar/main");
        expect(parsed.assistantAgentId).toBe("main");
      },
    });
  });

  it("includes trusted proxy bootstrap session when the request is already authenticated", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          {
            url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
            method: "GET",
            headers: {
              host: "gateway.local",
              "x-forwarded-user": "alice@example.com",
              "x-forwarded-name": "Alice",
              "x-tenant-id": "acme",
              "x-gateway-role": "operator",
              "x-gateway-scopes": "operator.read,operator.write",
              "x-forwarded-proto": "https",
            },
            socket: { remoteAddress: "127.0.0.1" },
          } as never,
          res,
          {
            root: { kind: "resolved", path: tmp },
            resolvedAuth: {
              mode: "trusted-proxy",
              allowTailscale: false,
              trustedProxy: {
                userHeader: "x-forwarded-user",
                displayNameHeader: "x-forwarded-name",
                tenantHeader: "x-tenant-id",
                roleHeader: "x-gateway-role",
                scopesHeader: "x-gateway-scopes",
                requiredHeaders: ["x-forwarded-proto"],
              },
            },
            trustedProxies: ["127.0.0.1"],
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.authMode).toBe("trusted-proxy");
        expect(parsed.authSession).toEqual({
          provider: "trusted-proxy",
          user: "alice@example.com",
          displayName: "Alice",
          tenantId: "acme",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        });
      },
    });
  });

  it("includes built-in platform auth bootstrap state when trusted-proxy platform auth is enabled", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          {
            url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
            method: "GET",
            headers: { host: "127.0.0.1:18789" },
            socket: { remoteAddress: "127.0.0.1" },
          } as never,
          res,
          {
            root: { kind: "resolved", path: tmp },
            resolvedAuth: {
              mode: "trusted-proxy",
              allowTailscale: false,
              trustedProxy: {
                userHeader: "x-forwarded-user",
                requiredHeaders: ["x-forwarded-proto"],
                platformAuth: {
                  enabled: true,
                  store: path.join(tmp, "platform-auth.json"),
                },
              },
            },
            trustedProxies: ["127.0.0.1"],
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.platformAuth).toMatchObject({
          enabled: true,
          hasUsers: false,
          hasPlatformAdmins: false,
          requiresPlatformBootstrap: true,
          availableModes: ["platform-bootstrap"],
        });
      },
    });
  });

  it("reports trusted-proxy browser auth session on bootstrap when gateway mode is token but platform auth is enabled", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const storePath = path.join(tmp, "platform-auth.json");
        const registerReq = {
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          socket: { remoteAddress: "127.0.0.1" },
        } as IncomingMessage;
        const body = JSON.stringify({
          email: "alice@example.com",
          password: "password-123",
          displayName: "Alice",
        });
        const { Readable } = await import("node:stream");
        const bootstrapReq = Readable.from([body]) as IncomingMessage;
        Object.assign(bootstrapReq, registerReq);
        const { handleControlUiPlatformAuthRequest } = await import("./platform-auth.js");
        const bootstrapMock = makeMockHttpResponse();
        await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapMock.res, {
          trustedProxy: {
            userHeader: "x-forwarded-user",
            platformAuth: {
              enabled: true,
              store: storePath,
            },
          },
          localDirect: true,
        });
        const rawCookie = bootstrapMock.setHeader.mock.calls.find(
          (call) => call[0] === "Set-Cookie",
        )?.[1];
        const sessionCookie = Array.isArray(rawCookie)
          ? rawCookie.find((v): v is string => typeof v === "string" && v.includes("="))
          : typeof rawCookie === "string"
            ? rawCookie
            : undefined;
        expect(typeof sessionCookie).toBe("string");

        const { res, end } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          {
            url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
            method: "GET",
            headers: {
              host: "127.0.0.1:18789",
              cookie: String(sessionCookie).split(";")[0],
            },
            socket: { remoteAddress: "127.0.0.1" },
          } as never,
          res,
          {
            root: { kind: "resolved", path: tmp },
            resolvedAuth: {
              mode: "token",
              allowTailscale: false,
              token: "secret",
              trustedProxy: {
                userHeader: "x-forwarded-user",
                platformAuth: {
                  enabled: true,
                  store: storePath,
                },
              },
            },
            trustedProxies: ["127.0.0.1"],
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.authMode).toBe("trusted-proxy");
        expect(parsed.authSession).toMatchObject({
          provider: "trusted-proxy",
          user: "alice@example.com",
          role: "operator",
        });
        expect(parsed.platformAuth).toMatchObject({
          enabled: true,
          sessionKind: "platform-super-admin",
        });
      },
    });
  });

  it("serves local avatar bytes through hardened avatar handler", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-avatar-http-"));
    try {
      const avatarPath = path.join(tmp, "main.png");
      await fs.writeFile(avatarPath, "avatar-bytes\n");

      const { res, end, handled } = runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("avatar-bytes\n");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects avatar symlink paths from resolver", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-avatar-http-link-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-avatar-http-outside-"));
    try {
      const outsideFile = path.join(outside, "secret.txt");
      await fs.writeFile(outsideFile, "outside-secret\n");
      const linkPath = path.join(tmp, "avatar-link.png");
      await fs.symlink(outsideFile, linkPath);

      const { res, end, handled } = runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: linkPath }),
      });

      expectNotFoundResponse({ handled, res, end });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlinked assets that resolve outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const assetsDir = path.join(tmp, "assets");
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ui-outside-"));
        try {
          const outsideFile = path.join(outsideDir, "secret.txt");
          await fs.mkdir(assetsDir, { recursive: true });
          await fs.writeFile(outsideFile, "outside-secret\n");
          await fs.symlink(outsideFile, path.join(assetsDir, "leak.txt"));

          const { res, end } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: "/assets/leak.txt", method: "GET" } as IncomingMessage,
            res,
            {
              root: { kind: "resolved", path: tmp },
            },
          );
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("allows symlinked assets that resolve inside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { assetsDir, filePath } = await writeAssetFile(tmp, "actual.txt", "inside-ok\n");
        await fs.symlink(filePath, path.join(assetsDir, "linked.txt"));

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/linked.txt",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("inside-ok\n");
      },
    });
  });

  it("serves HEAD for in-root assets without writing a body", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "actual.txt", "inside-ok\n");

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/actual.txt",
          method: "HEAD",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(end.mock.calls[0]?.length ?? -1).toBe(0);
      },
    });
  });

  it("serves top-level public assets from deep SPA routes", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await fs.writeFile(path.join(tmp, "favicon.ico"), "icon-bytes\n");

        const { res, end, handled } = await runControlUiRequest({
          url: "/enterprise/acme/usage-management/favicon.ico",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("icon-bytes\n");
      },
    });
  });

  it("caches content-hashed assets immutably", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "index-BnCxdOS4.js", "console.log(1);\n");

        const { setHeader, handled } = await runControlUiRequest({
          url: "/assets/index-BnCxdOS4.js",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Cache-Control")).toBe("public, max-age=31536000, immutable");
      },
    });
  });

  it("revalidates unhashed assets with no-cache", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "actual.txt", "inside-ok\n");

        const { setHeader, handled } = await runControlUiRequest({
          url: "/assets/actual.txt",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Cache-Control")).toBe("no-cache");
      },
    });
  });

  it("caches top-level brand images for a week", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await fs.writeFile(path.join(tmp, "openbot-logo.webp"), "logo-bytes\n");

        const { setHeader, handled } = await runControlUiRequest({
          url: "/openbot-logo.webp",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Cache-Control")).toBe("public, max-age=604800");
        expect(headerValue(setHeader, "Content-Type")).toBe("image/webp");
      },
    });
  });

  it("gzip-compresses large text assets when the client accepts gzip", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const source = `${"a".repeat(4096)}\n`;
        await writeAssetFile(tmp, "index-BnCxdOS4.js", source);

        const { setHeader, end, handled } = await runControlUiRequest({
          url: "/assets/index-BnCxdOS4.js",
          method: "GET",
          rootPath: tmp,
          headers: { "accept-encoding": "gzip, deflate, br" },
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Content-Encoding")).toBe("gzip");
        expect(headerValue(setHeader, "Vary")).toBe("Accept-Encoding");
        const body = end.mock.calls[0]?.[0] as Buffer;
        expect(Buffer.isBuffer(body)).toBe(true);
        expect(body.byteLength).toBeLessThan(source.length);
        expect(zlib.gunzipSync(body).toString("utf8")).toBe(source);
      },
    });
  });

  it("serves identity encoding when the client does not accept gzip", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const source = `${"a".repeat(4096)}\n`;
        await writeAssetFile(tmp, "index-BnCxdOS4.js", source);

        const { setHeader, end, handled } = await runControlUiRequest({
          url: "/assets/index-BnCxdOS4.js",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Content-Encoding")).toBeUndefined();
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe(source);
      },
    });
  });

  it("does not compress small assets even when gzip is accepted", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "index-BnCxdOS4.js", "console.log(1);\n");

        const { setHeader, handled } = await runControlUiRequest({
          url: "/assets/index-BnCxdOS4.js",
          method: "GET",
          rootPath: tmp,
          headers: { "accept-encoding": "gzip" },
        });

        expect(handled).toBe(true);
        expect(headerValue(setHeader, "Content-Encoding")).toBeUndefined();
      },
    });
  });

  it("rejects symlinked SPA fallback index.html outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ui-index-outside-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.symlink(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = await runControlUiRequest({
            url: "/app/route",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked index.html for non-package control-ui roots", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ui-index-hardlink-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside-hardlink</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.link(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = await runControlUiRequest({
            url: "/",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked asset files for custom/resolved roots (security boundary)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const assetsDir = path.join(tmp, "assets");
        await fs.mkdir(assetsDir, { recursive: true });
        await fs.writeFile(path.join(assetsDir, "app.js"), "console.log('hi');");
        await fs.link(path.join(assetsDir, "app.js"), path.join(assetsDir, "app.hl.js"));

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(404);
        expect(end).toHaveBeenCalledWith("Not Found");
      },
    });
  });

  it("serves hardlinked asset files for bundled roots (pnpm global install)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const assetsDir = path.join(tmp, "assets");
        await fs.mkdir(assetsDir, { recursive: true });
        await fs.writeFile(path.join(assetsDir, "app.js"), "console.log('hi');");
        await fs.link(path.join(assetsDir, "app.js"), path.join(assetsDir, "app.hl.js"));

        const { res, end, handled } = await runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
          rootKind: "bundled",
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("console.log('hi');");
      },
    });
  });

  it("does not handle POST to root-mounted paths (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const webhookPath of ["/bluebubbles-webhook", "/custom-webhook", "/callback"]) {
          const { res } = makeMockHttpResponse();
          const handled = await handleControlUiHttpRequest(
            { url: webhookPath, method: "POST" } as IncomingMessage,
            res,
            { root: { kind: "resolved", path: tmp } },
          );
          expect(handled, `POST to ${webhookPath} should pass through to plugin handlers`).toBe(
            false,
          );
        }
      },
    });
  });

  it("does not handle POST to paths outside basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res } = makeMockHttpResponse();
        const handled = await handleControlUiHttpRequest(
          { url: "/bluebubbles-webhook", method: "POST" } as IncomingMessage,
          res,
          { basePath: "/openclaw", root: { kind: "resolved", path: tmp } },
        );
        expect(handled).toBe(false);
      },
    });
  });

  it("does not handle /api paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const apiPath of ["/api", "/api/sessions", "/api/channels/nostr"]) {
          const { handled } = await runControlUiRequest({
            url: apiPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${apiPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("does not handle /plugins paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const pluginPath of ["/plugins", "/plugins/diffs/view/abc/def"]) {
          const { handled } = await runControlUiRequest({
            url: pluginPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${pluginPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("falls through POST requests when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { handled, end } = await runControlUiRequest({
          url: "/webhook/bluebubbles",
          method: "POST",
          rootPath: tmp,
        });
        expect(handled).toBe(false);
        expect(end).not.toHaveBeenCalled();
      },
    });
  });

  it("falls through POST requests under configured basePath (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const route of ["/openclaw", "/openclaw/", "/openclaw/some-page"]) {
          const { handled, end } = await runControlUiRequest({
            url: route,
            method: "POST",
            rootPath: tmp,
            basePath: "/openclaw",
          });
          expect(handled, `POST to ${route} should pass through to plugin handlers`).toBe(false);
          expect(end, `POST to ${route} should not write a response`).not.toHaveBeenCalled();
        }
      },
    });
  });

  it("rejects absolute-path escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "ui-secrets",
      fn: async ({ root, sibling }) => {
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const secretPathUrl = secretPath.split(path.sep).join("/");
        const absolutePathUrl = secretPathUrl.startsWith("/") ? secretPathUrl : `/${secretPathUrl}`;
        const { res, end, handled } = await runControlUiRequest({
          url: `/openclaw/${absolutePathUrl}`,
          method: "GET",
          rootPath: root,
          basePath: "/openclaw",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });

  it("rejects symlink escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "outside",
      fn: async ({ root, sibling }) => {
        await fs.mkdir(path.join(root, "assets"), { recursive: true });
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const linkPath = path.join(root, "assets", "leak.txt");
        try {
          await fs.symlink(secretPath, linkPath, "file");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") {
            return;
          }
          throw error;
        }

        const { res, end, handled } = await runControlUiRequest({
          url: "/openclaw/assets/leak.txt",
          method: "GET",
          rootPath: root,
          basePath: "/openclaw",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });
});
