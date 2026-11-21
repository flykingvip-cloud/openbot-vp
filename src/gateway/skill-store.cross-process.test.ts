import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
it("preserves skill creations and invocation receipts across concurrent real processes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skills-process-race-"));
  const workers = Array.from({ length: 4 }, (_, worker) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
   import {saveSkillAsset,commitRobotSkillInvocation,toggleRobotSkillAsset,upgradeRobotSkillAsset,removeRobotSkillAsset} from './src/gateway/skill-lifecycle-store.ts';
   import {ensureSkillExecutionBindingHooksRegistered} from './src/gateway/skill-execution-binding/register-hooks.ts';
   ensureSkillExecutionBindingHooksRegistered();
   process.once('message',()=>{
    try{for(let i=0;i<10;i++){
      const id='skill-'+process.env.WORKER+'-'+i;
      const saved=saveSkillAsset({skillId:id,sourceAgentId:'agent-'+id,lifecycle:'private',profile:{name:id,summary:'test',assetType:'capability',tags:[],category:'test',visibility:'private'}});
      commitRobotSkillInvocation({agentId:'agent-'+id,skillId:saved.skillId,invocationId:'invoke-'+id,atMs:10,audit:{id,outcome:'success'}});
      toggleRobotSkillAsset({agentId:'agent-'+id,skillId:saved.skillId,enabled:false});
      upgradeRobotSkillAsset({agentId:'agent-'+id,skillId:saved.skillId});
      if(i%2===0)removeRobotSkillAsset({agentId:'agent-'+id,skillId:saved.skillId});
    }process.disconnect();}catch(error){console.error(error);process.exitCode=1;process.disconnect();}
   });process.send('ready');
  `,
      ],
      {
        env: { ...process.env, OPENBOT_STATE_DIR: root, WORKER: String(worker) },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    return {
      child,
      ready: once(child, "message"),
      closed: once(child, "close"),
      error: () => stderr,
    };
  });
  try {
    await Promise.all(workers.map((w) => w.ready));
    for (const w of workers) {
      w.child.send("start");
    }
    const codes = await Promise.all(workers.map((w) => w.closed));
    for (let i = 0; i < codes.length; i++) {
      expect(codes[i][0], workers[i].error()).toBe(0);
    }
    const store = JSON.parse(await fs.readFile(path.join(root, "skill-assets/store.json"), "utf8"));
    expect(store.skills).toHaveLength(40);
    expect(store.robotRelations).toHaveLength(20);
    expect(Object.keys(store.invocationCommits)).toHaveLength(40);
    expect(store.robotRelations.every((row: { usageCount: number }) => row.usageCount === 1)).toBe(
      true,
    );
  } finally {
    for (const w of workers) {
      w.child.kill("SIGKILL");
    }
    await Promise.all(workers.map((w) => w.closed));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
