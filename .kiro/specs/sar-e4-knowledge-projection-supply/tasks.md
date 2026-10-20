# SAR E4 数据产品与知识供给

## Agents

- cursor-sar-e4 · role: owner · scope: 知识投影发布闸门、血缘字段与 Agent 知识对象消费 · paths: docs/design/sar-e4-knowledge-projection-supply-2026-10-17.md, src/gateway/enterprise-data/knowledge-publication.ts, src/gateway/enterprise-data/knowledge-publication.test.ts, src/gateway/enterprise-data/projection-materializer.ts, src/gateway/enterprise-data/projection-spec-store.ts, src/gateway/enterprise-data/data-gateway.ts, src/gateway/enterprise-data/sar-governance-bridge.ts, src/gateway/enterprise-data/types.ts · since: 2026-10-17

## Tasks

- [x] 复用 on-demand / scheduled，event_driven 保持未调度 — cursor-sar-e4
- [x] 发布闸门：失败、未验证、不完整默认不进完整知识对象；partial 需显式策略和可见标记 — cursor-sar-e4
- [x] 血缘补上 source / action / SAR version / run / validator；旧记录不默认为已验证 — cursor-sar-e4
- [x] Agent 只消费知识对象，写动作不进投影 — cursor-sar-e4
