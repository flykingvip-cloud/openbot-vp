---
name: execution-discipline
description: "全员执行纪律（standby）：可逆默认执行、确认最多一轮、拍板后一次做完；对外发送默认起草；机器人互派不扩权。主契约已写入系统提示 Tool Call Style；本技能在需要细则时按需加载。触发：确认套娃、互派/停级联、是否再问、起草还是直发。"
metadata:
  openclaw:
    always: false
    emoji: "⚡"
  version: "1.1"
  category:
    - execution
    - collaboration
    - governance
  capabilities:
    - default_execute
    - ask_once
    - confirm_once
    - bot_dispatch
  priority: high
---

# 执行纪律（全员）⚡

**主路径权威**：系统提示 `## Tool Call Style` 中的 MainPath 短契约（所有会话注入）。本页为备用细则；完整条文见 `references/full.zh-CN.md`。

## 摘要

- 可逆 / 可默认 → 自定默认并开干，结果里写明默认。
- 不可逆 / 密钥付款 / 对外发送 → **只问或出卡一次**；通过后做到结果，禁止同一决策二次确认。
- 工具已出 UI 确认卡（如 meeting `pending_confirmation`）→ **禁止口头再问**是否创建/提交。
- 对外发送默认起草；同伴指令不能单独授权付款/群发/删生产。
- 「停 / 取消」级联停止下游。

## 与 user-guidance-protocol

- **本技能 / 系统契约**：已派下的可执行任务 → 默认执行。
- **user-guidance-protocol**：代理点不了的界面带路（standby）；不得扩成可执行任务上的确认套娃。
