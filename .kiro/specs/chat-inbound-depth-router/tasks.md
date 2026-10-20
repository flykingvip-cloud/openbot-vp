# 对话入站深度路由

- [x] A. 纯文本早落盘 + 阶段事件（flag `OPENBOT_CHAT_INBOUND_PERSIST_EARLY`，默认关） — cursor-chat-inbound-depth
- [x] B. shadow 深度分类（flag `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW`，默认关） — cursor-chat-inbound-depth
- [x] C. `chat` 零知识零工具（flag `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER`，默认关） — cursor-chat-inbound-depth
- [x] D. 知识源面求交 / live 门 / 超时（flag `OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY`，默认关） — cursor-chat-inbound-depth
- [x] E. retrieve 只读白名单（flag `OPENBOT_CHAT_INBOUND_TOOL_POLICY`，默认关） — 最终签收 2026-08-27：`origin/main` `79f5bc228c` 已含 `inbound-tool-policy` + `get-reply-run` 接线；flag 默认 OFF；CIDR inbound 套件 6 files / 59 tests passing。chat.ts 无额外 CIDR land（persist-early 已在 main；tool-policy 不改 chat.ts）。router-off / space 断言与当前 get-reply-run（仅 `applyChatLane` 跳过 prefetch）对齐。 — cursor-chat-inbound-depth

## Agents

- cursor-chat-inbound-depth · role: owner · scope: personal steward chat.send inbound persist, depth router, knowledge/tool ceilings · paths: src/gateway/server-methods/chat.ts, src/gateway/chat-inbound-\*.ts, src/gateway/server.chat.gateway-server-chat.test.ts, src/auto-reply/reply/inbound-depth.ts, src/auto-reply/reply/get-reply-run.ts, src/gateway/knowledge/resolve/intent-classifier.ts, src/gateway/knowledge/resolve/resolve-engine.ts, src/agents/tool-policy.ts, src/agents/tool-catalog.ts, src/agents/inbound-tool-policy.ts, src/agents/pi-tools.ts, src/agents/pi-embedded-runner/**, .kiro/specs/chat-inbound-depth-router/**, docs/design/evidence/chat-inbound-depth-\*.json · since: 2026-08-20
