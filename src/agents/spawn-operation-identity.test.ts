import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createSpawnOperationResolver } from "./spawn-operation-identity.js";

function worker(root: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {createSpawnOperationResolver} from './src/agents/spawn-operation-identity.ts';
    const resolve=createSpawnOperationResolver({root:process.env.TEST_ROOT,tenantId:'tenant',taskId:'task',logicalExecutionId:'logical'});
    process.once('message',async () => {
      try {process.send(await resolve('recorded-call'));process.disconnect();}
      catch(error){console.error(error);process.exitCode=1;process.disconnect();}
    });
    process.send('ready');
  `,
    ],
    { env: { ...process.env, TEST_ROOT: root }, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const closed = once(child, "close");
  const ready = once(child, "message");
  return { child, closed, ready };
}
it("concurrent processes publish one complete identity and a fresh process reuses it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spawn-identity-processes-"));
  const workers = Array.from({ length: 6 }, () => worker(root));
  try {
    await Promise.all(workers.map((w) => w.ready));
    const receipts = workers.map((w) => once(w.child, "message"));
    for (const w of workers) {
      w.child.send("start");
    }
    const identities = (await Promise.all(receipts)).map(([value]) => value);
    expect(new Set(identities.map((value) => JSON.stringify(value))).size).toBe(1);
    expect((await Promise.all(workers.map((w) => w.closed))).map(([code]) => code)).toEqual(
      Array(6).fill(0),
    );
    const restarted = worker(root);
    workers.push(restarted);
    await restarted.ready;
    const receipt = once(restarted.child, "message");
    restarted.child.send("start");
    expect((await receipt)[0]).toEqual(identities[0]);
    expect((await restarted.closed)[0]).toBe(0);
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect((await fs.readdir(root)).some((name) => name.endsWith(".pending"))).toBe(false);
  } finally {
    for (const w of workers) {
      w.child.kill("SIGKILL");
    }
    await Promise.all(workers.map((w) => w.closed));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20_000);
it("fails closed on a corrupt published identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spawn-corrupt-"));
  try {
    const resolve = createSpawnOperationResolver({
      root,
      tenantId: "tenant",
      taskId: "task",
      logicalExecutionId: "logical",
    });
    await resolve("call");
    const [name] = await fs.readdir(root);
    await fs.writeFile(path.join(root, name), "{");
    await expect(resolve("call")).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.each(["mid-write", "before-link", "after-link"])(
  "recovers after SIGKILL at %s publication boundary",
  async (phase) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spawn-killed-publish-"));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import fs from 'node:fs/promises';
    import {createSpawnOperationResolver} from './src/agents/spawn-operation-identity.ts';
    const open=fs.open;
    fs.open=async (...args) => {
      const handle=await open(...args);
      if(process.env.PHASE==='mid-write' && String(args[0]).endsWith('.pending')) {
        handle.writeFile=async data => {
          await handle.write(String(data).slice(0,8));
          process.send('boundary');
          await new Promise(()=>{});
        };
      }
      return handle;
    };
    const original=fs.link;
    fs.link=async (...args) => {
      if(process.env.PHASE==='after-link') await original(...args);
      process.send('boundary');
      await new Promise(()=>{});
    };
    await createSpawnOperationResolver({root:process.env.TEST_ROOT,tenantId:'tenant',taskId:'task',logicalExecutionId:'logical'})('call');
  `,
      ],
      {
        env: { ...process.env, TEST_ROOT: root, PHASE: phase },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    const closed = once(child, "close");
    try {
      const ready = once(child, "message");
      expect((await Promise.race([ready, closed.then(() => ["early exit"])]))[0]).toBe("boundary");
      const canonical = (await fs.readdir(root)).filter((name) => name.endsWith(".json"));
      const published = canonical.length
        ? JSON.parse(await fs.readFile(path.join(root, canonical[0]), "utf8"))
        : undefined;
      expect(canonical.length).toBe(phase === "after-link" ? 1 : 0);
      child.kill("SIGKILL");
      await closed;
      const resolve = createSpawnOperationResolver({
        root,
        tenantId: "tenant",
        taskId: "task",
        logicalExecutionId: "logical",
      });
      const recovered = await resolve("call");
      if (published) {
        expect(recovered).toEqual(published);
      }
      expect(await resolve("call")).toEqual(recovered);
      expect((await fs.readdir(root)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    } finally {
      child.kill("SIGKILL");
      await closed;
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  20_000,
);
