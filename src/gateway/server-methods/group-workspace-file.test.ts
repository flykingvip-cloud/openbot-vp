import { createHash } from "node:crypto";
// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot } = vi.hoisted(() => ({
  tmpRoot: `/tmp/openbot-group-file-${Math.random().toString(36).slice(2)}`,
}));

let contextValue: { userId: string | null } = { userId: "user-a" };

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextValue),
}));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: vi.fn(async () => ({ tenantId: "t-a", userId: "user-a" })),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: () => ({
    ok: true,
    profile: "managed_enterprise",
    isolationLevel: "I3",
    source: "env",
    tenantExecutionBoundary: "dedicated",
    errors: [],
  }),
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => true,
  resolveDataMode: () => "shared",
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

const { groupWorkspaceFileHandlers, normalizeGroupWorkspaceRelativePath } =
  await import("./group-workspace-file.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

function findNamedFile(root: string, name: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && entry.name === name) {
        return next;
      }
    }
  }
  return null;
}

async function invoke(
  method: keyof typeof groupWorkspaceFileHandlers,
  params: Record<string, unknown>,
): Promise<InvokeResult> {
  let result: InvokeResult = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => {
    result = { ok, payload: payload as Record<string, unknown>, error };
  };
  const handler = groupWorkspaceFileHandlers[method];
  await handler({
    req: {} as never,
    params,
    client: {} as never,
    isWebchatConnect: () => false,
    respond: respond as never,
    context: {} as never,
  });
  return result;
}

describe("workbench.group-file preview/open/write", () => {
  const previousTenants = process.env.OPENBOT_TENANTS_ROOT;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.OPENBOT_TENANTS_ROOT = tmpRoot;
    contextValue = { userId: "user-a" };
    const membersPath = path.join(tmpRoot, "t-a", "collaboration", "groups", "g1", "members.json");
    fs.mkdirSync(path.dirname(membersPath), { recursive: true });
    fs.writeFileSync(
      membersPath,
      JSON.stringify([
        {
          memberId: "m1",
          memberKind: "human",
          userId: "user-a",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
    );
  });

  afterEach(() => {
    if (previousTenants === undefined) {
      delete process.env.OPENBOT_TENANTS_ROOT;
    } else {
      process.env.OPENBOT_TENANTS_ROOT = previousTenants;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("writes then previews via resolver-backed handlers", async () => {
    const write = await invoke("workbench.group-file.write", {
      groupId: "g1",
      filename: "deliverables/note.md",
      content: "# hello\n",
    });
    expect(write.ok).toBe(true);

    const preview = await invoke("workbench.group-file.preview", {
      groupId: "g1",
      filename: "deliverables/note.md",
    });
    expect(preview.ok).toBe(true);
    const previewBase64 = typeof preview.payload?.base64 === "string" ? preview.payload.base64 : "";
    expect(previewBase64).toBe(Buffer.from("# hello\n", "utf8").toString("base64"));

    const open = await invoke("workbench.group-file.open", {
      groupId: "g1",
      filename: "deliverables/note.md",
    });
    expect(open.ok).toBe(true);
  });

  it("refuses a zero-byte write and does not preview an empty file as openable", async () => {
    const refused = await invoke("workbench.group-file.write", {
      groupId: "g1",
      filename: "article-final.md",
      content: "",
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("empty workspace write refused");

    const seeded = await invoke("workbench.group-file.write", {
      groupId: "g1",
      filename: "article-final.md",
      content: "# 终稿\n",
    });
    expect(seeded.ok).toBe(true);
    expect(Number(seeded.payload?.byteLength)).toBeGreaterThan(0);

    const found = findNamedFile(tmpRoot, "article-final.md");
    expect(found).toBeTruthy();
    fs.writeFileSync(found!, "");
    const preview = await invoke("workbench.group-file.preview", {
      groupId: "g1",
      filename: "article-final.md",
    });
    expect(preview.ok).toBe(false);
    expect(preview.error?.message).toContain("not found");
  });

  it("denies cross-tenant member for the same groupId", async () => {
    const write = await invoke("workbench.group-file.write", {
      groupId: "g1",
      filename: "deliverables/x.md",
      content: "x",
    });
    expect(write.ok).toBe(true);

    // Swap tenant membership for t-b only — user-a is not a member there.
    const membersB = path.join(tmpRoot, "t-b", "collaboration", "groups", "g1", "members.json");
    fs.mkdirSync(path.dirname(membersB), { recursive: true });
    fs.writeFileSync(
      membersB,
      JSON.stringify([
        {
          memberId: "m2",
          memberKind: "human",
          userId: "user-b",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
    );

    const { resolveTenantContext } = await import("../tenant-context.js");
    vi.mocked(resolveTenantContext).mockResolvedValueOnce({
      tenantId: "t-b",
      userId: "user-a",
    } as never);

    const denied = await invoke("workbench.group-file.preview", {
      groupId: "g1",
      filename: "deliverables/x.md",
    });
    expect(denied.ok).toBe(false);
    expect(String(denied.error?.message ?? "")).toMatch(/not authorized/);
  });

  it("patches pptx slide text and returns a refreshed HTML preview", async () => {
    const seeded = await invoke("workbench.group-file.write", {
      groupId: "g1",
      filename: "deck.pptx",
      content: "placeholder",
    });
    expect(seeded.ok).toBe(true);

    const findNamed = (root: string, name: string): string | null => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isFile() && entry.name === name) {
          return full;
        }
        if (entry.isDirectory()) {
          const nested = findNamed(full, name);
          if (nested) {
            return nested;
          }
        }
      }
      return null;
    };
    const filePath = findNamed(tmpRoot, "deck.pptx");
    expect(filePath).toBeTruthy();

    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>组织新未来</a:t></p:sld>`,
    );
    fs.writeFileSync(filePath!, Buffer.from(await zip.generateAsync({ type: "nodebuffer" })));

    const patched = await invoke("workbench.group-file.patch-pptx", {
      expectedContentHash: createHash("sha256").update(fs.readFileSync(filePath!)).digest("hex"),
      groupId: "g1",
      filename: "deck.pptx",
      slides: [{ index: 1, lines: ["通州后勤方案"] }],
    });
    expect(patched.ok).toBe(true);
    expect(patched.payload?.renderKind).toBe("html");
    const html = typeof patched.payload?.html === "string" ? patched.payload.html : "";
    expect(html).toContain("通州后勤方案");
    expect(patched.payload?.officeSlides).toEqual([{ index: 1, lines: ["通州后勤方案"] }]);
    const savedBytes = fs.readFileSync(filePath!);
    expect(patched.payload?.contentHash).toBe(
      createHash("sha256").update(savedBytes).digest("hex"),
    );
    const stale = await invoke("workbench.group-file.patch-pptx", {
      groupId: "g1",
      filename: "deck.pptx",
      expectedContentHash: "0".repeat(64),
      slides: [{ index: 1, lines: ["stale"] }],
    });
    expect(stale.ok).toBe(false);
    expect(stale.error?.message).toContain("ARTIFACT_VERSION_CONFLICT");
    expect(fs.readFileSync(filePath!)).toEqual(savedBytes);
  });
});

describe("normalizeGroupWorkspaceRelativePath", () => {
  it("accepts deliverables and nested paths", () => {
    expect(normalizeGroupWorkspaceRelativePath("deliverables/report.pdf")).toBe(
      "deliverables/report.pdf",
    );
    expect(normalizeGroupWorkspaceRelativePath("reports/ai-org-report.pdf")).toBe(
      "reports/ai-org-report.pdf",
    );
  });

  it("rejects traversal and absolute paths", () => {
    expect(normalizeGroupWorkspaceRelativePath("../etc/passwd")).toBeNull();
    expect(normalizeGroupWorkspaceRelativePath("deliverables/../../secret")).toBeNull();
    expect(normalizeGroupWorkspaceRelativePath("/absolute/path")).toBeNull();
    expect(normalizeGroupWorkspaceRelativePath("")).toBeNull();
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeGroupWorkspaceRelativePath("deliverables\\report.pdf")).toBe(
      "deliverables/report.pdf",
    );
  });
});
