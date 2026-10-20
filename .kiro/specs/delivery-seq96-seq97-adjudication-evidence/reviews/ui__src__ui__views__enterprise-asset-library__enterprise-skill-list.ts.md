# 审查单

- 文件路径：`ui/src/ui/views/enterprise-asset-library/enterprise-skill-list.ts`
- 所属域：enterprise-capability
- seq 96 blob SHA：`7c8690d6600773808b04fd1ee324a869cf298e55`
- seq 97 blob SHA：`f6c5337c60bd4041f5272457ffa8595668ed360d`
- 删除行数：4
- 增加行数：11
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `function renderEmptyState(): TemplateResult {`
- `<div class="enterprise-skill-list__message" role="status">暂无匹配的能力资产，请调整筛选条件</div>`
- `listBody = renderEmptyState();`
- `renderEnterpriseSkillListCard({ item, onInstallToRobot, onViewDetail }),`
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
