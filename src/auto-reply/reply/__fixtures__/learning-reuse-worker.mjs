/**
 * 跨进程复用计数测试的子进程 worker。
 *
 * 被 `learning-recall-cross-process.e2e.test.ts` 以真实子进程启动：对同一个学习资产
 * 反复调用 `recordLearningReuse`，用来验证外层文件锁在**不同进程**之间互斥有效。
 * 环境变量由测试注入（作用域、资产 id、次数、隔离的 state/config 路径）。
 */

const scopeId = process.env.OPENBOT_XPROC_SCOPE;
const assetId = process.env.OPENBOT_XPROC_ASSET;
const count = Number.parseInt(process.env.OPENBOT_XPROC_COUNT ?? "0", 10);

if (!scopeId || !assetId || !Number.isFinite(count) || count <= 0) {
  console.error("worker-misconfigured");
  process.exit(2);
}

const { recordLearningReuse } = await import("../learning-recall.ts");

for (let i = 0; i < count; i += 1) {
  await recordLearningReuse({ scopeId, assetIds: [assetId] });
}

console.log("worker-done");
