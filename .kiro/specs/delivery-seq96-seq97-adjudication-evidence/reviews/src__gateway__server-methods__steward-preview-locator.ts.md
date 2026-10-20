# 审查单

- 文件路径：`src/gateway/server-methods/steward-preview-locator.ts`
- 所属域：steward
- seq 96 blob SHA：`98435f2f141821c3557ee6e87b653cd1624073bd`
- seq 97 blob SHA：`bad52743eb0499bccd01e5e3768dd15c60ba7e1d`
- 删除行数：14
- 增加行数：95
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `// Look one directory down.`
- `if (`
- `!entry.isDirectory() ||`
- `SKIP_PREVIEW_SCAN_DIRS.has(entry.name) ||`
- `entry.name.startsWith(".")`
- `) {`
- `const candidate = path.join(root, entry.name, basename);`
- `if (fs.statSync(candidate).isFile()) {`
- seq 97 对应实现位置：同一路径在 seq 97 仍存在。被删行为是否被挪走，本次不判断。
- 相关测试：本次未建立与该删行一一对应的通过证据。
- 生产 smoke marker：本次未记录该文件的生产 smoke。
- 当前判断：insufficient_evidence
- 未解决问题：删行是保留、搬迁、有意移除，还是意外回归，没有域 Owner 的行为证据。
- 所需签字角色：Steward Owner

- 审查人：cursor-independent-acceptor
- 代理角色：Steward Owner
- 签字方式：operator_authorized_proxy
- reviewedAt：2026-09-25T07:45:00Z
- 裁决理由：删行对应的行为是否保留、搬迁、有意移除或意外回归，diff 不能单独证明。
