import { describe, expect, it, vi } from "vitest";
import { extractFeishuResourceIds, readFeishuUserDocx } from "./enterprise-im-feishu-doc-reader.js";

const DOC = "doxcnInScopeDocument0000001";
const OTHER = "doxcnOtherDocument000000001";
const OUT = "doxcnOutOfScopeLink00000001";
const USER = "u-user-token-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("feishu user docx reader", () => {
  it("reads real docx url tokens and does not treat them as an allow-all", () => {
    const ids = extractFeishuResourceIds(
      "进度见 https://example.feishu.cn/docx/doxcnOutOfScopeLink00000001 和 https://example.feishu.cn/wiki/wikcnOutOfScopeNode00000001 以及 oc_a0553eda9014c201e6969b478895c230",
    );
    expect(ids).toEqual([
      "doxcnOutOfScopeLink00000001",
      "wikcnOutOfScopeNode00000001",
      "oc_a0553eda9014c201e6969b478895c230",
    ]);
  });

  it("loads title, revision, and body with the user token only", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      urls.push(href);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${USER}`);
      expect(JSON.stringify(init)).not.toContain("cli_app_secret");
      if (href.endsWith("/raw_content")) {
        return jsonResponse({
          code: 0,
          data: {
            content: `本周三完成接口联调，剩余风险是权限审批。详见 https://example.feishu.cn/docx/${OUT}`,
          },
        });
      }
      return jsonResponse({
        code: 0,
        data: { document: { document_id: DOC, revision_id: 12, title: "项目进度" } },
      });
    });
    const read = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(urls.some((url) => url.endsWith(`/documents/${DOC}`))).toBe(true);
    expect(urls.some((url) => url.endsWith(`/documents/${DOC}/raw_content`))).toBe(true);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.doc.resourceId).toBe(DOC);
    expect(read.doc.title).toBe("项目进度");
    expect(read.doc.revisionId).toBe("12");
    expect(read.doc.body).toContain("本周三完成接口联调，剩余风险是权限审批。");
    expect(read.doc.links).toEqual([OUT]);
  });

  it("stops when the returned document id does not match and does not request the body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: { document: { document_id: OTHER, revision_id: 1, title: "别的" } },
      }),
    );
    const read = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(read).toMatchObject({ ok: false, kind: "resource_id_mismatch", returnedId: OTHER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(read)).not.toContain("别的正文");
  });

  it("classifies token, rate limit, missing doc, and network failures", async () => {
    const invalid = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: vi.fn(async () =>
        jsonResponse({ code: 99991663, msg: "invalid" }, 401),
      ) as typeof fetch,
    });
    const limited = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: vi.fn(async () =>
        jsonResponse({ code: 99991400, msg: "limit" }, 429),
      ) as typeof fetch,
    });
    const missing = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: vi.fn(async () =>
        jsonResponse({ code: 1770002, msg: "not found" }, 404),
      ) as typeof fetch,
    });
    const network = await readFeishuUserDocx({
      resourceId: DOC,
      accessToken: USER,
      fetchImpl: vi.fn(async () => {
        throw new Error("econnreset");
      }) as typeof fetch,
    });
    expect(invalid).toMatchObject({ ok: false, kind: "invalid_user_token" });
    expect(limited).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(missing).toMatchObject({ ok: false, kind: "not_found" });
    expect(network).toMatchObject({ ok: false, kind: "network" });
  });
});
