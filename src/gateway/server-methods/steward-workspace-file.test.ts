// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot } = vi.hoisted(() => ({
  tmpRoot: `/tmp/openbot-steward-file-${Math.random().toString(36).slice(2)}`,
}));

let contextValue: { userId: string | null; tenantId?: string | null } = {
  userId: "user-elle",
  tenantId: "001",
};

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextValue),
}));

vi.mock("../../agents/builtin-steward/employee-isolation.js", () => ({
  resolveEmployeeBuiltinStewardWorkspaceDir: (userId: string) =>
    path.join(tmpRoot, userId, "workspace"),
  extractEmployeeStewardUserIdFromSessionKey: (sessionKey?: string) => {
    const match = /^agent:main:employee:([^:]+)$/i.exec(sessionKey?.trim() ?? "");
    return match?.[1]?.toLowerCase() ?? null;
  },
}));

vi.mock("../../agents/builtin-steward/identity.js", () => ({
  isBuiltinStewardAgent: (agentId: string) => agentId === "main",
}));

vi.mock("../employee-workbench-scope.js", () => ({
  isPersonalWorkbenchClient: () => false,
  resolveEmployeeWorkbenchActor: vi.fn(async () => null),
  filterAgentsForEmployeeActor: (agents: unknown[]) => agents,
}));

vi.mock("../../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => tmpRoot,
  };
});

vi.mock("../tenant-context.js", () => ({
  resolveAgentWorkspaceDirForClient: vi.fn(async (_client: unknown, agentId: string) =>
    path.join(tmpRoot, "agents", agentId, "workspace"),
  ),
  resolveTenantContext: vi.fn(async () => ({ tenantId: "001", userId: "user-elle" })),
}));

vi.mock("../agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => ({
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  }),
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => false,
  resolveDataMode: () => "local",
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    agents: {
      list: [
        { id: "agt-hrqb", workspace: path.join(tmpRoot, "agents", "agt-hrqb", "workspace") },
        { id: "main", workspace: path.join(tmpRoot, "agents", "main", "workspace") },
      ],
    },
  }),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [{ id: "agt-hrqb" }, { id: "main" }],
  }),
}));

const { stewardWorkspaceFileHandlers } = await import("./steward-workspace-file.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

async function invokeWrite(filename: string, content: string): Promise<InvokeResult> {
  let result: InvokeResult = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => {
    result = { ok, payload: payload as Record<string, unknown>, error };
  };
  const handler = stewardWorkspaceFileHandlers["workbench.steward-file.write"];
  await handler({
    req: {} as never,
    params: { filename, content } as Record<string, unknown>,
    client: {} as never,
    isWebchatConnect: () => false,
    respond: respond as never,
    context: {} as never,
  });
  return result;
}

async function invoke(filename: unknown, extra?: Record<string, unknown>): Promise<InvokeResult> {
  let result: InvokeResult = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => {
    result = { ok, payload: payload as Record<string, unknown>, error };
  };
  const handler = stewardWorkspaceFileHandlers["workbench.steward-file.read"];
  await handler({
    req: {} as never,
    params: { filename, ...extra } as Record<string, unknown>,
    client: {} as never,
    isWebchatConnect: () => false,
    respond: respond as never,
    context: {} as never,
  });
  return result;
}

/** Build a minimal but valid .docx (OOXML zip) mammoth can render, containing `text`. */
async function makeMinimalDocx(text: string): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function leftoverDir(userId: string): string {
  return path.join(tmpRoot, "agents", "main", "employees", userId, "workspace");
}

function robotOwnDir(agentId = "main"): string {
  return path.join(
    tmpRoot,
    "tenants",
    "001",
    "users",
    "user-elle",
    "OpenBot",
    "agents",
    agentId,
    "workspace",
  );
}

beforeEach(() => {
  contextValue = { userId: "user-elle", tenantId: "001" };
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(robotOwnDir(), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("workbench.steward-file.read", () => {
  it("reads a text file from the caller's own steward workspace", async () => {
    fs.writeFileSync(path.join(robotOwnDir(), "notes.md"), "# Hello\nWorld");
    const res = await invoke("notes.md");
    expect(res.ok).toBe(true);
    expect(res.payload?.filename).toBe("notes.md");
    expect(res.payload?.textLike).toBe(true);
    expect(res.payload?.mimeType).toBe("text/markdown");
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf-8")).toBe(
      "# Hello\nWorld",
    );
  });

  it("marks binary office files as non-text so the UI downloads them", async () => {
    fs.writeFileSync(
      path.join(robotOwnDir(), "resume.docx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    const res = await invoke("resume.docx");
    expect(res.ok).toBe(true);
    expect(res.payload?.textLike).toBe(false);
    expect(String(res.payload?.mimeType)).toContain("wordprocessingml");
  });

  it("rejects path traversal via ../ without reading another file", async () => {
    fs.mkdirSync(path.join(tmpRoot, "user-elle"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "user-elle", "secret.txt"), "SECRET");
    fs.writeFileSync(path.join(robotOwnDir(), "secret.txt"), "ROOT-TWIN");
    const res = await invoke("../secret.txt");
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("invalid workspace path");
    expect(JSON.stringify(res.payload ?? {})).not.toContain("SECRET");
    expect(JSON.stringify(res.payload ?? {})).not.toContain("ROOT-TWIN");
  });

  it("does not map an absolute path outside the workspace", async () => {
    const abs = path.join(tmpRoot, "user-elle", "secret.txt");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "SECRET");
    const res = await invoke(abs);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("cannot resolve workspace path");
    expect(JSON.stringify(res.payload ?? {})).not.toContain("SECRET");
  });

  it("reads a nested relative path and does not copy it onto a basename", async () => {
    const nested = path.join(robotOwnDir(), "campaigns", "october");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "article.html"), "<html>nested</html>");
    fs.writeFileSync(path.join(robotOwnDir(), "article.html"), "<html>twin</html>");
    const res = await invoke("campaigns/october/article.html");
    expect(res.ok).toBe(true);
    expect(res.payload?.relativePath).toBe("campaigns/october/article.html");
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe(
      "<html>nested</html>",
    );
    expect(fs.existsSync(path.join(robotOwnDir(), "output", "html", "article.html"))).toBe(false);
  });

  it("maps an absolute path under the workspace and a container alias to the same file", async () => {
    const nested = path.join(robotOwnDir(), "campaigns", "october");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "article.html"), "<html>mapped</html>");
    const hostAbs = path.join(robotOwnDir(), "campaigns", "october", "article.html");
    const fromHost = await invoke(hostAbs);
    const fromContainer = await invoke("/account/workspace/campaigns/october/article.html");
    const fromGatewayMount = await invoke("/workspace/campaigns/october/article.html");
    for (const res of [fromHost, fromContainer, fromGatewayMount]) {
      expect(res.ok).toBe(true);
      expect(res.payload?.relativePath).toBe("campaigns/october/article.html");
      expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe(
        "<html>mapped</html>",
      );
    }
  });

  it("refuses a prefix sibling and another tenant absolute path", async () => {
    const sibling = `${robotOwnDir()}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "article.html"), "SIBLING");
    const other = path.join(
      tmpRoot,
      "tenants",
      "002",
      "users",
      "other",
      "OpenBot",
      "agents",
      "main",
      "workspace",
      "campaigns",
      "october",
    );
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "article.html"), "OTHER");
    const siblingRes = await invoke(path.join(sibling, "article.html"));
    const otherRes = await invoke(path.join(other, "article.html"));
    expect(siblingRes.ok).toBe(false);
    expect(otherRes.ok).toBe(false);
    expect(siblingRes.error?.message).toContain("cannot resolve workspace path");
    expect(otherRes.error?.message).toContain("cannot resolve workspace path");
    expect(JSON.stringify(siblingRes.payload ?? {})).not.toContain("SIBLING");
    expect(JSON.stringify(otherRes.payload ?? {})).not.toContain("OTHER");
  });

  it("refuses a symlink that escapes the workspace", async () => {
    const outside = path.join(tmpRoot, "outside-secret.html");
    fs.writeFileSync(outside, "SYMLINK-SECRET");
    fs.mkdirSync(path.join(robotOwnDir(), "campaigns", "october"), { recursive: true });
    fs.symlinkSync(outside, path.join(robotOwnDir(), "campaigns", "october", "article.html"));
    const res = await invoke("campaigns/october/article.html");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("SYMLINK-SECRET");
  });

  it("reports a missing nested file separately from an unmappable path", async () => {
    const missing = await invoke("campaigns/october/missing.html");
    const unmapped = await invoke("/tmp/not-a-workspace/campaigns/october/missing.html");
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toContain("not synced for preview");
    expect(unmapped.ok).toBe(false);
    expect(unmapped.error?.message).toContain("cannot resolve workspace path");
    expect(unmapped.error?.message).not.toContain("not synced");
  });

  it("uses the same relative path for preview and read", async () => {
    const nested = path.join(robotOwnDir(), "campaigns", "october");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "article.html"), "<html>same</html>");
    const read = await invoke("campaigns/october/article.html");
    let preview: InvokeResult = { ok: false };
    const respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      preview = { ok, payload: payload as Record<string, unknown>, error };
    };
    await stewardWorkspaceFileHandlers["workbench.steward-file.preview"]({
      req: {} as never,
      params: { filename: "campaigns/october/article.html" } as Record<string, unknown>,
      client: {} as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });
    expect(preview.ok).toBe(true);
    expect(preview.payload?.relativePath).toBe(read.payload?.relativePath);
    expect(preview.payload?.base64).toBe(read.payload?.base64);
  });

  it("returns not-found for a missing file", async () => {
    const res = await invoke("missing.md");
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("not synced for preview");
  });

  it("treats a zero-byte file as not synced for preview", async () => {
    fs.writeFileSync(path.join(robotOwnDir(), "article-final.md"), "");
    const res = await invoke("article-final.md");
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("not synced for preview");
  });

  it("writes a non-empty markdown file that preview can open", async () => {
    const write = await invokeWrite("article-final.md", "# 终稿\n正文\n");
    expect(write.ok).toBe(true);
    expect(Number(write.payload?.byteLength)).toBeGreaterThan(0);
    const read = await invoke("article-final.md");
    expect(read.ok).toBe(true);
    expect(Buffer.from(String(read.payload?.base64), "base64").toString("utf8")).toContain("终稿");
  });

  it("refuses a zero-byte steward write", async () => {
    const write = await invokeWrite("article-final.md", "");
    expect(write.ok).toBe(false);
    expect(write.error?.message).toContain("empty workspace write refused");
    expect(fs.existsSync(path.join(robotOwnDir(), "article-final.md"))).toBe(false);
  });

  it("requires an authenticated user context", async () => {
    contextValue = { userId: null };
    const res = await invoke("notes.md");
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("user context required");
  });

  it("renders a produced .docx to HTML when render is requested", async () => {
    const docx = await makeMinimalDocx("Hello from docx");
    fs.writeFileSync(path.join(robotOwnDir(), "resume.docx"), docx);
    const res = await invoke("resume.docx", { render: true });
    expect(res.ok).toBe(true);
    expect(res.payload?.renderKind).toBe("html");
    expect(String(res.payload?.html)).toContain("Hello from docx");
    // HTML preview keeps the original package so download uses the same bytes.
    expect(res.payload?.base64).toBe(docx.toString("base64"));
  });

  it("renders a produced .xlsx to HTML with original bytes for download", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>品类</t></si><si><t>数量</t></si><si><t>A</t></si><si><t>B</t></si></sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>10</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>20</v></c></row>
</sheetData></worksheet>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    const xlsx = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    fs.writeFileSync(path.join(robotOwnDir(), "sales.xlsx"), xlsx);
    const res = await invoke("sales.xlsx", { render: true });
    expect(res.ok).toBe(true);
    expect(res.payload?.renderKind).toBe("html");
    expect(String(res.payload?.html)).toContain("品类");
    expect(String(res.payload?.html)).toMatch(/<svg\b/i);
    expect(typeof res.payload?.base64).toBe("string");
    expect(res.payload?.base64).toBe(xlsx.toString("base64"));
  });

  it("returns bytes (no html) for a .docx download when render is not requested", async () => {
    const docx = await makeMinimalDocx("Hello from docx");
    fs.writeFileSync(path.join(robotOwnDir(), "resume.docx"), docx);
    const res = await invoke("resume.docx");
    expect(res.ok).toBe(true);
    expect(res.payload?.html).toBeUndefined();
    expect(typeof res.payload?.base64).toBe("string");
  });

  it("still returns bytes for a text file even when render is requested", async () => {
    fs.writeFileSync(path.join(robotOwnDir(), "notes.md"), "# Hello");
    const res = await invoke("notes.md", { render: true });
    expect(res.ok).toBe(true);
    expect(res.payload?.html).toBeUndefined();
    expect(res.payload?.textLike).toBe(true);
    expect(typeof res.payload?.base64).toBe("string");
  });

  it("reads a personal-agent deliverable via sessionKey from the robot own space", async () => {
    fs.mkdirSync(robotOwnDir("agt-hrqb"), { recursive: true });
    fs.writeFileSync(
      path.join(robotOwnDir("agt-hrqb"), "三地布局_修订版.docx"),
      Buffer.from([0x50, 0x4b]),
    );
    const res = await invoke("三地布局_修订版.docx", {
      sessionKey: "agent:agt-hrqb:main",
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.filename).toBe("三地布局_修订版.docx");
    expect(res.payload?.relativePath).toBe("三地布局_修订版.docx");
    expect(res.payload?.textLike).toBe(false);
  });

  it("does not read another user's leftover or robot workspace", async () => {
    fs.mkdirSync(leftoverDir("other-user"), { recursive: true });
    fs.writeFileSync(
      path.join(leftoverDir("other-user"), "secret.docx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    const res = await invoke("secret.docx", {
      sessionKey: "agent:main:main",
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("not synced for preview");
  });

  it("reads a compliant workspace-relative write and misses a bare name with no bytes", async () => {
    const write = await invokeWrite("reports/人才回流.docx", "PK-docx-bytes");
    expect(write.ok).toBe(true);
    expect(write.payload?.relativePath).toBe("reports/人才回流.docx");
    const read = await invoke("reports/人才回流.docx");
    expect(read.ok).toBe(true);
    expect(read.payload?.relativePath).toBe("reports/人才回流.docx");
    expect(Buffer.from(String(read.payload?.base64), "base64").toString("utf8")).toBe(
      "PK-docx-bytes",
    );
    const bare = await invoke("人才回流.docx");
    expect(bare.ok).toBe(true);
    expect(bare.payload?.relativePath).toBe("reports/人才回流.docx");
    fs.rmSync(path.join(robotOwnDir(), "reports"), { recursive: true, force: true });
    const missing = await invoke("人才回流.docx");
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toContain("not synced for preview");
  });

  it("refuses Downloads, another user's space, and a media zip stub", async () => {
    const other = path.join(
      tmpRoot,
      "tenants",
      "001",
      "users",
      "user-bob",
      "OpenBot",
      "agents",
      "main",
      "workspace",
      "secret.docx",
    );
    fs.mkdirSync(path.dirname(other), { recursive: true });
    const downloads = await invokeWrite("~/Downloads/人才回流.docx", "nope");
    const foreign = await invokeWrite(other, "nope");
    const zipStub = await invokeWrite(
      "media/inbound/11111111-1111-4111-8111-111111111111/人才回流.zip",
      "nope",
    );
    expect(downloads.ok).toBe(false);
    expect(downloads.error?.message).toContain("Downloads");
    expect(foreign.ok).toBe(false);
    expect(foreign.error?.message).toContain("another user");
    expect(zipStub.ok).toBe(false);
    expect(zipStub.error?.message).toContain("zip stub");
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.existsSync(path.join(robotOwnDir(), "media", "inbound"))).toBe(false);
  });

  it("finds bare basenames under an immediate task subdirectory", async () => {
    fs.mkdirSync(path.join(robotOwnDir(), "刘晶交接"), { recursive: true });
    fs.writeFileSync(
      path.join(robotOwnDir(), "刘晶交接", "交接梳理-项目进度.html"),
      "<html>ok</html>",
    );
    const res = await invoke("交接梳理-项目进度.html");
    expect(res.ok).toBe(true);
    expect(res.payload?.filename).toBe("交接梳理-项目进度.html");
    expect(res.payload?.relativePath).toBe("刘晶交接/交接梳理-项目进度.html");
  });
});
