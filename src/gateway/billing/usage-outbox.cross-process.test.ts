import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
it("retains all durable receipts from simultaneous independent writers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-processes-")),
    file = path.join(root, "outbox.json");
  const workers = Array.from({ length: 4 }, (_, worker) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
   import {enqueueUsageOutbox} from './src/gateway/billing/usage-outbox-store.ts';
   process.once('message',async()=>{try{for(let i=0;i<15;i++){await enqueueUsageOutbox({enterpriseId:'tenant',taskId:process.env.WORKER+'-'+i,modelId:'test/model',policyId:'policy'},process.env.TEST_FILE);}process.disconnect();}catch(error){console.error(error);process.exitCode=1;process.disconnect();}});process.send('ready');
  `,
      ],
      {
        env: { ...process.env, WORKER: String(worker), TEST_FILE: file },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let error = "";
    child.stderr?.on("data", (chunk) => {
      error += chunk;
    });
    return {
      child,
      ready: once(child, "message"),
      closed: once(child, "close"),
      error: () => error,
    };
  });
  try {
    await Promise.all(workers.map((w) => w.ready));
    for (const w of workers) {
      w.child.send("start");
    }
    const codes = await Promise.all(workers.map((w) => w.closed));
    codes.forEach(([code], i) => expect(code, workers[i].error()).toBe(0));
    expect(Object.keys(JSON.parse(await fs.readFile(file, "utf8")).byId)).toHaveLength(60);
  } finally {
    for (const w of workers) {
      w.child.kill("SIGKILL");
    }
    await Promise.all(workers.map((w) => w.closed));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20000);
