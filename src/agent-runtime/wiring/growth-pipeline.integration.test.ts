import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(!process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL)(
  "real database capture and operational event update the authorized GrowthStatus",
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-real-pipeline-"));
    const schema = `growth_pipeline_${randomUUID().replaceAll("-", "")}`;
    const source = `
 import fs from 'node:fs/promises';
 import {createRequire} from 'node:module';
 import {resolveTenantAgentDirForContext} from './src/gateway/tenant-store-paths.ts';
 import {saveSkillAsset,installSkillToRobotAsset} from './src/gateway/skill-lifecycle-store.ts';
 import {captureAuthorizedCloseoutGrowth} from './src/agent-runtime/wiring/growth-closeout-producer.ts';
 import {createGrowthServiceAuthorizer} from './src/agent-runtime/state/postgres/growth-service-authority.ts';
 import {createGrowthCaptureConsumer} from './src/agent-runtime/state/postgres/growth-capture-consumer.ts';
 import {createBackgroundGrowthConsumer} from './src/gateway/agent-growth/background-consumer-authority.ts';
 import {PostgresRuntimeOutbox} from './src/agent-runtime/state/postgres/outbox.ts';
 import {drainRuntimeOutbox} from './src/agent-runtime/state/postgres/outbox-consumer.ts';
 import {resolveRuntimeEventHandler} from './src/agent-runtime/state/postgres/event-handlers.ts';
 import {readRobotGrowthStatus} from './src/gateway/agent-growth/store.ts';
 const {Client}=createRequire(import.meta.url)('pg');
 const db=new Client({connectionString:process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL});await db.connect();
 try{
 await db.query('CREATE SCHEMA '+process.env.TEST_SCHEMA);await db.query('SET search_path TO '+process.env.TEST_SCHEMA);
 await db.query(await fs.readFile('src/agent-runtime/state/postgres/execution.sql','utf8'));
 await db.query("INSERT INTO runtime_growth_service_grants VALUES ('tenant','principal','user','enterprise',ARRAY['agent'],true,clock_timestamp()+interval '1 hour')");
 const context={tenantId:'tenant',userId:'user',domain:'enterprise'};
 const dir=resolveTenantAgentDirForContext(context,'agent');await fs.mkdir(dir,{recursive:true});
 const metrics={tasksTotal:1,tasksSucceeded:1,toolsTotal:1,toolsSucceeded:1,humanTakeovers:0,takeoverObservations:0,satisfactionPositive:0,satisfactionNegative:0,updatedAtMs:100};
 await fs.writeFile(dir+'/operational-metrics.json',JSON.stringify(metrics));
 const cfg={agents:{list:[{id:'agent',agentDir:dir}]}};
 const skill=saveSkillAsset({sourceAgentId:'source',lifecycle:'private',profile:{name:'Test skill',summary:'test',assetType:'capability',tags:[],category:'test',visibility:'private'}});
 installSkillToRobotAsset({agentId:'agent',skillId:skill.skillId,tenantId:'tenant',ownerUserId:'user'});
 const {runWithPostgresTurnLease}=await import('./src/agent-runtime/wiring/postgres-turn-lease.ts');
 const outcome=await runWithPostgresTurnLease({followupRun:{run:{agentId:'agent',config:cfg,executionIdentity:{enterpriseId:'tenant'},taskCompletionBinding:{taskId:'task',executionAttempt:'attempt',logicalExecutionId:'execution'}}},opts:{}},
   async()=>({kind:'success',commitGrowthOutcome:async()=>{}}));
 await outcome.commitGrowthOutcome(true,{acceptance:{status:'passed'},delivery:{status:'delivered'},deliveryId:'trusted-delivery'});
 const authorize=createGrowthServiceAuthorizer(db,'tenant','principal');
 const capture=createGrowthCaptureConsumer({db,tenantId:'tenant',capture:(agentId,executionId)=>captureAuthorizedCloseoutGrowth({db,cfg,tenantId:'tenant',executionId,agentId,principalId:'principal'})});
 const consume=createBackgroundGrowthConsumer({cfg,tenantId:'tenant',authorize});
 const unavailable=async()=>{throw new Error('unavailable')};
 const ports={growth:unavailable,statistics:unavailable,aor:unavailable,recovery:unavailable,growthCapture:capture,growthOperational:consume};
 const store=new PostgresRuntimeOutbox(db,['growth.capture','growth.operational']);
 if(process.env.CRASH_TEST==='1'){
   const ack=store.acknowledge.bind(store);
   store.acknowledge=async(...args)=>{
     if(args[1].endsWith(':operational')){
       const status=await fs.readFile(dir+'/growth-status.json','utf8');
       await fs.writeFile(process.env.CRASH_RECEIPT,status);
       process.kill(process.pid,'SIGKILL');
     }
     return ack(...args);
   };
 }
 const result=await drainRuntimeOutbox({tenantId:'tenant',store,resolveHandler:event=>resolveRuntimeEventHandler(ports,event)});
 const growth=await readRobotGrowthStatus(cfg,'agent',{agentDir:dir});
 console.log(JSON.stringify({result,score:growth?.operationalScore,observation:growth?.operationalObservationAtMs}));
 }finally{await db.query('DROP SCHEMA IF EXISTS '+process.env.TEST_SCHEMA+' CASCADE');await db.end();}
 `;
    const crashReceipt = path.join(root, "before-crash.json");
    const { Client } = createRequire(import.meta.url)("pg");
    const control = new Client({ connectionString: process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL });
    await control.connect();
    try {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", source],
        {
          env: {
            ...process.env,
            OPENBOT_STATE_DIR: root,
            OPENBOT_TENANTS_ROOT: path.join(root, "tenants"),
            OPENBOT_RUNTIME_DATABASE_URL: `${process.env.OPENBOT_RUNTIME_TEST_DATABASE_URL}?options=-csearch_path%3D${schema}`,
            OPENBOT_RUNTIME_GROWTH_CONSUMER: "1",
            OPENBOT_RUNTIME_GROWTH_PRINCIPAL_ID: "principal",
            TEST_SCHEMA: schema,
            CRASH_TEST: "1",
            CRASH_RECEIPT: crashReceipt,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(code, err).toBeNull();
      const before = JSON.parse(await fs.readFile(crashReceipt, "utf8"));
      await control.query(`SET search_path TO ${schema}`);
      await control.query(
        "UPDATE runtime_execution_outbox SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE delivered_at IS NULL",
      );
      const recoverySource =
        source.slice(0, source.indexOf(" try{")) +
        `
 try{
 await db.query('SET search_path TO '+process.env.TEST_SCHEMA);
 const context={tenantId:'tenant',userId:'user',domain:'enterprise'};
 const dir=resolveTenantAgentDirForContext(context,'agent');
 const cfg={agents:{list:[{id:'agent',agentDir:dir}]}};
 const authorize=createGrowthServiceAuthorizer(db,'tenant','principal');
 const consume=createBackgroundGrowthConsumer({cfg,tenantId:'tenant',authorize});
 const unavailable=async()=>{throw new Error('unexpected event')};
 const ports={growth:unavailable,statistics:unavailable,aor:unavailable,recovery:unavailable,growthOperational:consume};
 const store=new PostgresRuntimeOutbox(db,['growth.operational']);
 const result=await drainRuntimeOutbox({tenantId:'tenant',store,resolveHandler:event=>resolveRuntimeEventHandler(ports,event)});
 console.log(JSON.stringify({result,state:JSON.parse(await fs.readFile(dir+'/growth-status.json','utf8'))}));
 }finally{await db.end();}
 `;
      const recovery = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", recoverySource],
        {
          env: {
            ...process.env,
            OPENBOT_STATE_DIR: root,
            OPENBOT_TENANTS_ROOT: path.join(root, "tenants"),
            TEST_SCHEMA: schema,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let recoveredOutput = "",
        recoveryError = "";
      recovery.stdout.on("data", (chunk) => {
        recoveredOutput += chunk;
      });
      recovery.stderr.on("data", (chunk) => {
        recoveryError += chunk;
      });
      const recoveredCode = await new Promise<number | null>((resolve, reject) => {
        recovery.once("error", reject);
        recovery.once("close", resolve);
      });
      expect(recoveredCode, recoveryError).toBe(0);
      const summary = JSON.parse(recoveredOutput.trim().split("\n").at(-1)!);
      expect(summary.result).toMatchObject({ acknowledged: 1, failed: 0 });
      expect(summary.state).toEqual(before);
      expect(
        (
          await control.query(
            "SELECT count(*)::int AS n FROM runtime_execution_outbox WHERE delivered_at IS NOT NULL",
          )
        ).rows[0].n,
      ).toBe(2);
    } finally {
      await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await control.end();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
