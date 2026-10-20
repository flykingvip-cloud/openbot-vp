# 审查单

- 文件路径：`src/gateway/server-methods/employee-capability.ts`
- 所属域：enterprise-capability
- seq 96 blob SHA：`220723213b164499297a18325b7d18e2139526c5`
- seq 97 blob SHA：`17873c652fe759e988346cd71c0a0bb78eb1ae5b`
- 删除行数：4
- 增加行数：44
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `installSkillToRobotAsset({ agentId, skillId: installCapabilityId });`
- `const projection = syncSkillExecutionBinding({`
- `projection.action !== "materialised"`
- `mounted: projection.action === "materialised",`
- seq 97 对应实现位置：同一路径在 seq 97 仍存在。被删行为是否被挪走，本次不判断。
- 相关测试：本次未建立与该删行一一对应的通过证据。
- 生产 smoke marker：本次未记录该文件的生产 smoke。
- 当前判断：insufficient_evidence
- 未解决问题：删行是保留、搬迁、有意移除，还是意外回归，没有域 Owner 的行为证据。
- 所需签字角色：Enterprise Capability Owner

- 审查人：cursor-independent-acceptor
- 代理角色：Enterprise Capability Owner
- 签字方式：operator_authorized_proxy
- reviewedAt：2026-09-25T07:45:00Z
- 裁决理由：删行对应的行为是否保留、搬迁、有意移除或意外回归，diff 不能单独证明。
