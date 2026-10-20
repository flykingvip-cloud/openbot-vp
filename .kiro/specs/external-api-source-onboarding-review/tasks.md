# External API Source Onboarding Independent Review

## Agents

- codex-api-source-reviewer · role: owner · scope: 独立审核并修复外部 API 技能、运行环境、企业共享消费与部署验收缺口 · paths: `.kiro/specs/external-api-source-onboarding-review/**`, `skills/configure-external-api-source/SKILL.md`, `skills/configure-external-api-source/scripts/probe-http-api.mjs`, `skills/configure-external-api-source/scripts/probe-http-api.test.mjs`, `src/agents/tools/knowledge-source-tool.ts`, `src/agents/tools/knowledge-source-tool.test.ts`, `src/gateway/knowledge/sources/source-api-runtime.ts`, `src/gateway/knowledge/sources/source-api-runtime.test.ts`, `src/gateway/knowledge/resolve/resolve-engine.ts`, `src/gateway/knowledge/resolve/resolve-engine.evidence.test.ts` · since: 2026-08-04

登记来源：`.loom/registry.yaml` 中的 `external-api-source-onboarding-review:codex-api-source-reviewer`。

## Tasks

- [x] 验证固定请求路径 API 能被目录、标题或显式路由元数据命中并主动消费。— codex-api-source-reviewer
- [x] 验证企业知识库可读成员能够消费共享主动源，同时保持未授权隔离。— codex-api-source-reviewer
- [x] 验证旧目录结构、SecretRef、脚本/运行时网络边界和大白工具授权。— codex-api-source-reviewer
- [ ] 完成真实 API 探测、构建门禁、提交、推送和部署后验收。WIP：相关测试与局部 lint 已通过；FFD 返回 `API_KEY_DISABLED`，雪球返回 HTTP 429；全仓构建被其他共享 WIP 的类型错误阻断，因此禁止推送部署。— codex-api-source-reviewer
