import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeProbeSnapshot,
  hashProbeSnapshot,
  statPathForSnapshot,
  type ProbeSnapshotEntry,
} from "./health-probe-snapshot.js";

describe("canonicalizeProbeSnapshot", () => {
  const fixtureA: ProbeSnapshotEntry[] = [
    {
      path: "/tmp/b.sqlite",
      present: true,
      type: "file",
      size: 100,
      mtimeMs: 1_700_000_000_000,
      contentSha256: "abc",
    },
    {
      path: "/tmp/a/memory/1.md",
      present: false,
      type: "missing",
    },
  ];

  const fixtureB: ProbeSnapshotEntry[] = [
    {
      path: "/tmp/a/memory/1.md",
      present: false,
      type: "missing",
    },
    {
      path: "/tmp/b.sqlite",
      present: true,
      type: "file",
      size: 100,
      mtimeMs: 1_700_000_000_000,
      contentSha256: "abc",
    },
  ];

  it("produces identical hash regardless of input array order", () => {
    expect(hashProbeSnapshot(fixtureA)).toBe(hashProbeSnapshot(fixtureB));
  });

  it("uses fixed entry field order in canonical text", () => {
    const canonical = canonicalizeProbeSnapshot(fixtureA);
    expect(canonical).toMatch(
      /^path=\/tmp\/a\/memory\/1\.md\|present=false\|type=missing\npath=\/tmp\/b\.sqlite\|present=true\|type=file\|size=100\|mtimeMs=1700000000000\|contentSha256=abc$/,
    );
  });

  it("matches checked-in AC-O0-4 fixture canonical and sha256", () => {
    const fixture = JSON.parse(
      fs.readFileSync(new URL("./health-probe-snapshot.fixture.json", import.meta.url), "utf8"),
    ) as { canonical: string; sha256: string };
    const entries: ProbeSnapshotEntry[] = [
      {
        path: "/probe/fixture/index.sqlite-wal",
        present: false,
        type: "missing",
      },
      {
        path: "/probe/fixture/index.sqlite",
        present: true,
        type: "file",
        size: 4096,
        mtimeMs: 1_234_567_890_000,
        contentSha256: "deadbeef",
      },
    ];
    expect(canonicalizeProbeSnapshot(entries)).toBe(fixture.canonical);
    expect(hashProbeSnapshot(entries)).toBe(fixture.sha256);
  });
});

describe("statPathForSnapshot sqlite sidecars", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits mtime for -shm so readonly open refresh is not a mutation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-shm-"));
    dirs.push(dir);
    const shmPath = path.join(dir, "agent.sqlite-shm");
    fs.writeFileSync(shmPath, "shm-bytes");
    const first = statPathForSnapshot(shmPath);
    const later = Date.now() + 5;
    fs.utimesSync(shmPath, later / 1000, later / 1000);
    const second = statPathForSnapshot(shmPath);
    expect(first.mtimeMs).toBeUndefined();
    expect(second.mtimeMs).toBeUndefined();
    expect(hashProbeSnapshot([first])).toBe(hashProbeSnapshot([second]));
  });
});
