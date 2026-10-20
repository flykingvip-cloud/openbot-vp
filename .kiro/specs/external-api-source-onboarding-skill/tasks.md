# External API Source Onboarding Skill

## Agents

- codex-api-source-skill · role: owner · scope: 提炼并实现外部 API 主动知识源的配置、探测、绑定、消费与可见性验收技能套件及大白工具环境 · paths: `.kiro/specs/external-api-source-onboarding-skill/**`, `skills/configure-external-api-source/**`, `src/agents/builtin-steward/provision.ts`, `src/agents/builtin-steward/provision.test.ts`, `src/agents/builtin-steward/required-skills.ts`, `src/agents/builtin-steward/required-skills.test.ts`, `src/agents/builtin-steward/steward-skills-sync.ts`, `src/agents/builtin-steward/steward-skills-sync.test.ts`, `src/agents/openclaw-tools.ts`, `src/agents/openclaw-tools.knowledge-source.test.ts`, `src/agents/tool-catalog.ts`, `src/agents/tools/knowledge-source-tool.ts`, `src/agents/tools/knowledge-source-tool.test.ts`, `src/gateway/knowledge/sources/source-api-runtime.ts`, `src/gateway/knowledge/sources/source-api-runtime.test.ts`, `src/gateway/knowledge/sources/ffd-query-planner.ts`, `src/gateway/knowledge/sources/ffd-query-planner.test.ts`, `src/gateway/knowledge/resolve/resolve-engine.ts`, `src/gateway/knowledge/resolve/resolve-engine.evidence.test.ts` · since: 2026-08-04

登记来源：`.loom/registry.yaml` 中的 `external-api-source-onboarding-skill:codex-api-source-skill`。本块是派生视图，改动请先走 `loom register`。

## Tasks

- [x] 定义凭据安全、接口发现、最小探测、绑定和验收的标准流程。— codex-api-source-skill
- [x] 提供 OpenBot 主动知识源 RPC 契约与故障分类参考。— codex-api-source-skill
- [x] 提供可重复执行且默认脱敏的 HTTP 探测脚本。— codex-api-source-skill
- [x] 验证技能结构、脚本行为和典型配置场景。— codex-api-source-skill
- [x] 提供大白可调用的受控知识源配置、同步、调用和验收工具；明文密钥仍只允许经浏览器安全凭据控件写入，大白只接收 SecretRef。— codex-api-source-skill
- [x] 新绑定仅持久化 SecretRef，运行时兼容读取存量内联凭据，并增加 DNS SSRF、同源、重定向、方法、超时及请求/响应尺寸边界。— codex-api-source-skill
- [x] 将技能加入大白强制技能清单，验证完整技能目录和探测脚本同步到 workspace。— codex-api-source-skill
- [x] 验证 FFD 问题经目录规划、最小请求和 `ku://active/` 证据进入 Agent 上下文。— codex-api-source-skill
