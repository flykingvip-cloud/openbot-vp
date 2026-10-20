import {
  createFailClosedWechatPersonalWorker,
  type WechatPersonalWorker,
} from "./worker-contract.js";

let worker: WechatPersonalWorker = createFailClosedWechatPersonalWorker();
let injected = false;

export function getWechatPersonalWorker(): WechatPersonalWorker {
  return worker;
}

export function isWechatPersonalWorkerInjected(): boolean {
  return injected;
}

/** Test / local-node injection. Production default remains fail-closed. */
export function setWechatPersonalWorker(next: WechatPersonalWorker): void {
  worker = next;
  injected = true;
}

export function resetWechatPersonalWorker(): void {
  worker = createFailClosedWechatPersonalWorker();
  injected = false;
  boundNodeRegistry = undefined;
}

let boundNodeRegistry:
  | import("./resolve-worker.js").WechatWorkerResolveOpts["nodeRegistry"]
  | undefined;

export function bindWechatPersonalNodeRegistry(
  registry: import("./resolve-worker.js").WechatWorkerResolveOpts["nodeRegistry"] | undefined,
): void {
  boundNodeRegistry = registry;
}

export function getBoundWechatPersonalNodeRegistry():
  | import("./resolve-worker.js").WechatWorkerResolveOpts["nodeRegistry"]
  | undefined {
  return boundNodeRegistry;
}

export {
  createFailClosedWechatPersonalWorker,
  createMemoryWechatPersonalWorker,
  WECHAT_WORKER_COMMANDS,
  WECHAT_WORKER_OFFLINE_ERROR,
  WECHAT_PERSONAL_INBOUND_EVENT,
  type WechatPersonalWorker,
  type WechatWorkerLoginStartResult,
  type WechatWorkerLoginWaitResult,
  type WechatWorkerProbeResult,
  type WechatWorkerStatusResult,
} from "./worker-contract.js";

export { createLocalHttpWechatPersonalWorker } from "./local-http-worker.js";
export { createNodeInvokeWechatPersonalWorker } from "./node-invoke-worker.js";
