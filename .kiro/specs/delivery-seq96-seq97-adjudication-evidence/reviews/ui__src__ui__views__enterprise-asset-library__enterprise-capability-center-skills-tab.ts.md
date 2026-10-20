# 审查单

- 文件路径：`ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-skills-tab.ts`
- 所属域：enterprise-capability
- seq 96 blob SHA：`f9f01f59fed079ef6f11e7d9f2b1e7b0c1f2926f`
- seq 97 blob SHA：`cfc6ca9e679daf84ea262c67e9aaed8e063c3cdf`
- 删除行数：5
- 增加行数：20
- 被删除代码的职责：未裁决。以下只是被删文本样本，不代表行为结论。
- `placeholder="搜索能力名称、描述或来源"`
- `aria-label="搜索能力名称、描述或来源"`
- `<div id="skills" class="enterprise-capability-center-page__skills-tab">`
- `${renderDomainChips(props)}`
- `${renderScenarioTags(props)}`
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
