# 审查单

- 文件路径：`src/gateway/evolution-governance/application-consumption-shadow.ts`
- 所属域：evolution
- seq 96 blob SHA：`4aff8e7e3b6ee21c83e83ae442994535c5804499`
- seq 97 blob SHA：`f2aea87a10ac29f1e4b620adba96d5b7ceb61c17`
- 删除行数：52
- 增加行数：541
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `source: "runtime-auto-tick" | "skill-auto-pass";`
- `livePath: "direct-runtime-action" | "direct-skill-install";`
- `function readRows(configDir: string = CONFIG_DIR): ConsumptionShadowRecord[] {`
- `if (!fs.existsSync(filePath)) {`
- `return [];`
- `}`
- `const rows: ConsumptionShadowRecord[] = [];`
- `for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {`
- seq 97 对应实现位置：同一路径在 seq 97 仍存在。被删行为是否被挪走，本次不判断。
- 相关测试：本次未建立与该删行一一对应的通过证据。
- 生产 smoke marker：本次未记录该文件的生产 smoke。
- 当前判断：insufficient_evidence
- 未解决问题：删行是保留、搬迁、有意移除，还是意外回归，没有域 Owner 的行为证据。
- 所需签字角色：Evolution Owner

- 审查人：cursor-independent-acceptor
- 代理角色：Evolution Owner
- 签字方式：operator_authorized_proxy
- reviewedAt：2026-09-25T07:45:00Z
- 裁决理由：删行对应的行为是否保留、搬迁、有意移除或意外回归，diff 不能单独证明。
