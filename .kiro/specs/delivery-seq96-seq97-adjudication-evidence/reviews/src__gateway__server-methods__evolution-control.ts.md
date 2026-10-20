# 审查单

- 文件路径：`src/gateway/server-methods/evolution-control.ts`
- 所属域：evolution
- seq 96 blob SHA：`412e590efd6fdc32ac07ccb66f220a2390692822`
- seq 97 blob SHA：`9a2993198ea8860af8707b6815abcd1b6c9245c8`
- 删除行数：14
- 增加行数：156
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `if ("principalRef" in params || "tenantId" in params) {`
- `errorShape(ErrorCodes.INVALID_REQUEST, "clients cannot declare principalRef or tenantId"),`
- `if (Array.isArray(scopes) && !scopes.includes("operator.approvals")) {`
- `const principalRef = client?.user?.trim() ?? "";`
- `if (!principalRef) {`
- `errorShape(ErrorCodes.INVALID_REQUEST, "operator identity is required"),`
- `const principalRef = requireOperatorApprovalSession(client, params, respond);`
- `if (!principalRef) {`
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
