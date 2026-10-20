import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";

const note = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({
  note,
}));

import { maybePurgeRemovedFeatureCredentials } from "./doctor-removed-feature-credentials.js";

function prompter(answer: boolean) {
  return {
    confirmSkipInNonInteractive: vi.fn(async () => answer),
  };
}

describe("maybePurgeRemovedFeatureCredentials", () => {
  let root: string;
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(async () => {
    note.mockClear();
    envSnapshot = captureEnv(["OPENCLAW_STATE_DIR"]);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-doctor-removed-creds-"));
    process.env.OPENCLAW_STATE_DIR = root;
  });

  afterEach(async () => {
    envSnapshot.restore();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function seedCloudDriveStore() {
    const dir = path.join(root, "knowledge");
    await fs.mkdir(dir, { recursive: true });
    const store = path.join(dir, "cloud-drive-credentials.json");
    const key = `${store}.key`;
    await fs.writeFile(store, JSON.stringify({ byBindingId: {} }), "utf8");
    await fs.writeFile(key, JSON.stringify({ key: "AAAA" }), "utf8");
    return { dir, store, key };
  }

  it("stays silent when no leftover credentials exist", async () => {
    const p = prompter(true);
    await maybePurgeRemovedFeatureCredentials(p);

    expect(p.confirmSkipInNonInteractive).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
  });

  it("deletes the cloud-drive token store and its key when confirmed", async () => {
    const { dir, store, key } = await seedCloudDriveStore();
    const p = prompter(true);

    await maybePurgeRemovedFeatureCredentials(p);

    await expect(fs.access(store)).rejects.toThrow();
    await expect(fs.access(key)).rejects.toThrow();
    // The directory only ever held this store, so it goes too.
    await expect(fs.access(dir)).rejects.toThrow();

    const titles = note.mock.calls.map(([, title]) => title);
    expect(titles).toContain("Removed feature credentials");
    expect(titles).toContain("Doctor changes");
    const changes = note.mock.calls.find(([, title]) => title === "Doctor changes")?.[0] as string;
    expect(changes).toContain("cloud-drive-credentials.json");
    expect(changes).toContain("cloud-drive-credentials.json.key");
  });

  it("keeps the files and explains the fix when declined", async () => {
    const { store, key } = await seedCloudDriveStore();
    const p = prompter(false);

    await maybePurgeRemovedFeatureCredentials(p);

    await expect(fs.access(store)).resolves.toBeUndefined();
    await expect(fs.access(key)).resolves.toBeUndefined();

    const warning = note.mock.calls.find(
      ([, title]) => title === "Removed feature credentials",
    )?.[0] as string;
    expect(warning).toContain("Found 2 leftover credential file(s)");
    expect(warning).toContain("doctor --fix");
    expect(note.mock.calls.map(([, title]) => title)).not.toContain("Doctor changes");
  });

  it("leaves the directory alone when it holds unrelated files", async () => {
    const { dir, store } = await seedCloudDriveStore();
    const keep = path.join(dir, "something-else.json");
    await fs.writeFile(keep, "{}", "utf8");

    await maybePurgeRemovedFeatureCredentials(prompter(true));

    await expect(fs.access(store)).rejects.toThrow();
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });
});
