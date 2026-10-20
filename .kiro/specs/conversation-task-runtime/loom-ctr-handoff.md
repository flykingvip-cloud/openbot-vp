# Loom 交接:落地 CTR landing stream(致 registry lander kiro-loom)

> 发起: `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 目的: 请 registry lander(`loom-workspace-orchestrator:kiro-loom`)提交 `.loom/registry.yaml` 的
> 工作树改动,使 `conversation-task-runtime` 的文件有正式落地归属(landing stream)。

## 背景

`conversation-task-runtime` 的代码位于新模块 `src/conversation-task/**`,pre-commit 的
`scripts/worktree-audit.ts --cached --fail-on-unmatched` 要求每个暂存路径匹配某个 landingStream。
为此在 `.loom/registry.yaml` 的 `landingStreams:` 首位新增了 `CTR` 流:

```yaml
- id: CTR
  landingPolicy: serial
  paths:
    - .kiro/specs/conversation-task-runtime/**
    - src/conversation-task/**
  canLandWith: []
  metadata:
    legacyTitle: ConversationTask Runtime (P0/P1 offline detection + qualification)
    task: conversation-task-runtime
    owner: kiro-conversation-task-runtime
```

放在首位是为了让 `.kiro/specs/conversation-task-runtime/**` 与 `src/conversation-task/**` 都解析到 CTR
(单一 primary group),避免与通用流 `F`(`.kiro/specs/**`)混组触发 `--fail-on-risky-mix`。

## 请 kiro-loom 执行

1. 仅由 registry lander 提交 `.loom/registry.yaml`(本 agent 未提交、也不会提交该文件):
   `scripts/committer "Loom: register CTR landing stream for conversation-task-runtime" .loom/registry.yaml`
2. **保留** 现有 `ownerHistory` 与 `sessions[]`:`conversation-task-runtime:codex-plan` 的
   `ownerHistory`(`codex-conversation-task-plan → kiro-conversation-task-runtime`,`via: verified`)与两个
   session(codex 计划 session + 我的 `kiro-conversation-task-runtime-20260824`)必须原样保留。
3. **不要**使用 `loom import --write`(避免重写/丢失既有会话与历史)。CTR 是一次普通的 YAML 追加,直接提交即可。

## 已完成的核对(landing 前)

- CTR 存在于工作树 registry(`.loom/registry.yaml`,`landingStreams:` 首项)。
- `node --import tsx scripts/loom.ts status` 显示 `owner=kiro-conversation-task-runtime`,两个 session 均 active。
- `node --import tsx scripts/loom.ts lint`:无任何 `CTR` / `conversation-task` 相关告警或错误;
  现存的 `impossible-glob` / `duplicate-task-id` / `dangling-can-land-with` 报错均属其它任务的既有数据问题,与本次无关。
- `bun scripts/agent-attribution.ts`:`src/conversation-task/**` 与 `.kiro/specs/conversation-task-runtime/**`
  全部归属 `kiro-conversation-task-runtime`,无 `UNATTRIBUTED`、无 `CONFLICT`。

## landing 后请复跑

```bash
node --import tsx scripts/loom.ts status
node --import tsx scripts/loom.ts lint         # 确认未新增 CTR 相关问题
bun scripts/agent-attribution.ts               # 确认 conversation-task 文件仍归属正确
```
