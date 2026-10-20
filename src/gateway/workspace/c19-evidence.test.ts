import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SUMMARY_PATH = path.resolve(
  process.cwd(),
  "docs/design/evidence/workspace-isolation-20260810-001.summary.json",
);
const PROBE_PATH = path.resolve(process.cwd(), "scripts/audit/workspace-isolation-probe.mjs");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("C19 controlled evidence summary", () => {
  it("recomputes summarySha256 for the historical pre-cutover 001 summary", () => {
    const raw = fs.readFileSync(SUMMARY_PATH, "utf8");
    const summary = JSON.parse(raw) as Record<string, unknown>;
    expect(summary.classification).toBe("controlled-audit-desensitized");
    expect(summary.evidenceId).toBe("workspace-isolation-20260810-001");
    expect(summary.cluster).toEqual({ tenantCount: 10, userDirCount: 50 });
    // Historical artifact: A/B/C all recent — cannot alone close post-P0 C19.
    const pathSummary = summary.pathSummary as Record<string, { recentCount: number }>;
    expect(pathSummary.A_employee.recentCount).toBeGreaterThan(0);
    expect(pathSummary.B_flat_l2.recentCount).toBeGreaterThan(0);
    expect(pathSummary.C_agent_main.recentCount).toBeGreaterThan(0);

    const expectSha = typeof summary.summarySha256 === "string" ? summary.summarySha256 : "";
    expect(expectSha).toMatch(/^[a-f0-9]{64}$/);
    delete summary.summarySha256;
    const got = crypto
      .createHash("sha256")
      .update(`${JSON.stringify(summary, null, 2)}\n`)
      .digest("hex");
    expect(got).toBe(expectSha);
  });

  it("keeps shared host roots out of writable path classes in the summary shape", () => {
    const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8")) as {
      pathSummary: Record<string, { pathPattern: string }>;
    };
    // E/F are inventory risk surfaces on disk — not tenant user writable canonicals.
    expect(summary.pathSummary.E_skill_host?.pathPattern).toContain("workspace-bot-skill");
    expect(summary.pathSummary.F_canvas?.pathPattern).toContain("canvas");
    expect(summary.pathSummary.B_flat_l2?.pathPattern).toContain("tenants/<sample-tenant>");
  });

  it("emits c19Assertions.allPass on a post-cutover fixture with binding manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c19-ev-"));
    tempDirs.push(root);
    const workspace = path.join(
      root,
      "tenants",
      "t1",
      "users",
      "u1",
      "OpenBot",
      "workspace",
      "docs",
    );
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(path.join(root, "tenants", "t2", "users", "u2"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "note.md"), "canonical\n");
    fs.writeFileSync(
      path.join(root, ".openbot-c19-bindings.json"),
      JSON.stringify({
        ownerScopes: [
          {
            kind: "user_owned",
            canonicalClassId: "B_flat_l2",
            legacyClassIds: { A_employee: "retired", C_agent_main: "retired" },
          },
        ],
        unknownOwnership: { count: 0, isolated: true },
      }),
    );

    const raw = spawnSync(process.execPath, [PROBE_PATH, root, "--mode", "raw-controlled"], {
      env: {
        ...process.env,
        SAMPLE_TENANT: "t1",
        SAMPLE_USER: "u1",
        PROBE_AT: "2026-08-10T18:00:00Z",
        RECENT_DAYS: "14",
      },
      encoding: "utf8",
    });
    expect(raw.status).toBe(0);
    const summary = spawnSync(
      process.execPath,
      [PROBE_PATH, "--mode", "summary-redacted", "--evidence-id", "fixture-pass"],
      {
        input: raw.stdout,
        encoding: "utf8",
      },
    );
    expect(summary.status).toBe(0);
    const parsed = JSON.parse(summary.stdout) as {
      summarySha256: string;
      probe: { scriptSha256: string };
      c19Assertions: {
        gates: { allPass: boolean; failures: string[] };
        sharedRootRecentWrites: { total: number };
        writableCanonicalByOwnerScope: Array<{ canonicalClassId: string }>;
      };
      limits?: {
        maxFiles?: number;
        maxDepth?: number;
        maxBytesRead?: number;
      } | null;
      stats?: {
        truncated?: boolean;
        errorCount?: number;
      };
    };
    expect(parsed.c19Assertions.gates.allPass).toBe(true);
    expect(parsed.c19Assertions.gates.failures).toEqual([]);
    expect(parsed.c19Assertions.sharedRootRecentWrites.total).toBe(0);
    expect(parsed.c19Assertions.writableCanonicalByOwnerScope).toEqual([
      expect.objectContaining({ canonicalClassId: "B_flat_l2" }),
    ]);
    expect(parsed.summarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.probe.scriptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.limits).toEqual(
      expect.objectContaining({
        maxFiles: expect.any(Number),
        maxDepth: expect.any(Number),
        maxBytesRead: expect.any(Number),
      }),
    );
    expect(typeof parsed.stats?.truncated).toBe("boolean");
    expect(typeof parsed.stats?.errorCount).toBe("number");
  });

  it("rejects symlink that physically escapes stateDir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c19-symlink-"));
    tempDirs.push(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "c19-outside-"));
    tempDirs.push(outside);
    fs.writeFileSync(path.join(outside, "leak.md"), "secret\n");

    const workspace = path.join(root, "tenants", "t1", "users", "u1", "OpenBot", "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    fs.symlinkSync(outside, path.join(workspace, "escape-link"));

    const raw = spawnSync(process.execPath, [PROBE_PATH, root, "--mode", "raw-controlled"], {
      env: {
        ...process.env,
        SAMPLE_TENANT: "t1",
        SAMPLE_USER: "u1",
        PROBE_AT: "2026-08-10T18:00:00Z",
        RECENT_DAYS: "14",
      },
      encoding: "utf8",
    });
    expect(raw.status).toBe(0);
    const parsed = JSON.parse(raw.stdout) as {
      errors: Array<{ error: string }>;
      pathSummary: { B_flat_l2: { deliverableCount: number } };
    };
    expect(parsed.errors.some((e) => e.error.includes("symlink escapes stateDir physically"))).toBe(
      true,
    );
    expect(parsed.pathSummary.B_flat_l2.deliverableCount).toBe(0);
  });

  it("applies MAX_FILES globally across classes (not per class)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "c19-maxfiles-"));
    tempDirs.push(root);
    const b = path.join(root, "tenants", "t1", "users", "u1", "OpenBot", "workspace");
    const e = path.join(root, "skills");
    fs.mkdirSync(b, { recursive: true });
    fs.mkdirSync(e, { recursive: true });
    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(path.join(b, `b${i}.md`), "b\n");
      fs.writeFileSync(path.join(e, `e${i}.md`), "e\n");
    }

    const raw = spawnSync(process.execPath, [PROBE_PATH, root, "--mode", "raw-controlled"], {
      env: {
        ...process.env,
        SAMPLE_TENANT: "t1",
        SAMPLE_USER: "u1",
        PROBE_AT: "2026-08-10T18:00:00Z",
        RECENT_DAYS: "14",
        MAX_FILES: "4",
      },
      encoding: "utf8",
    });
    expect(raw.status).toBe(0);
    const parsed = JSON.parse(raw.stdout) as {
      stats: { truncated: boolean; seenFiles: number };
    };
    expect(parsed.stats.truncated).toBe(true);
    expect(parsed.stats.seenFiles).toBeGreaterThan(4);
  });
});
