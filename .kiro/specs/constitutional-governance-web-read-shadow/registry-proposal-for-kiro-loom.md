# Registry 提案（供 kiro-loom 落地）

> **已落地（本地 commit）。** lander：`kiro-loom`（本整改授权代理）。
> 落地 trailers：`Task: loom-workspace-orchestrator` / `Agent: kiro-loom`
> 提案作者材料 Owner：`grok-bot`（specs 材料不 commit）
> Agent: grok-bot

## 意图

在 `.loom/registry.yaml` 的任务列表中**追加**下列条目（形状对齐 Phase A `constitutional-governance-discovery:grok-bot`）。

## 精确 YAML 片段（append）

```yaml
- id: constitutional-governance-web-read-shadow:grok-bot
  owner: grok-bot
  intent: []
  paths:
    - .kiro/specs/constitutional-governance-web-read-shadow/**
  state: active
  sessions:
    - id: 8A94CE45-8365-4D85-BEFB-591C44B6AB78
      taskId: constitutional-governance-web-read-shadow:grok-bot
      ide: cursor
      agent: grok-bot
      status: active
      lastSignalAt: 2026-09-24T00:51:37+08:00
      metadata: {}
  ownerHistory: []
  since: 2026-09-24
  metadata: {}
```

## 约束

- `paths` **仅** `.kiro/specs/constitutional-governance-web-read-shadow/**`
- 不覆盖、不改写 Phase A `constitutional-governance-discovery/**` 或其他任务路径
- `state` 意图：`active`
- session id 为新建 UUID（大写）：`8A94CE45-8365-4D85-BEFB-591C44B6AB78`
- `lastSignalAt` = BaselineManifest 材料初版 `assessedAt`：`2026-09-24T00:51:37+08:00`

## 落地责任

| 项                             | 值                                                       |
| ------------------------------ | -------------------------------------------------------- |
| lander                         | `kiro-loom`                                              |
| trailers                       | `Task: loom-workspace-orchestrator` / `Agent: kiro-loom` |
| 本提案是否已写入 registry.yaml | **是**（本地）                                           |
| Registry commit SHA            | `55d669bc76a2b4837d0414cd0312178aaebd736c`               |
| 是否 push / PR                 | **否**（用户禁止）                                       |

— Agent: grok-bot
