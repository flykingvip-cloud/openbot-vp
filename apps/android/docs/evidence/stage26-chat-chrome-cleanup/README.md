# Stage 2.6 — Chat chrome cleanup + pull-to-reconnect (evidence)

Locks (核查验收):

1. Message-list **pull-to-refresh only** (no toolbar Refresh button).
2. Pull → `refreshGatewayConnection()`; if no cached `connectedEndpoint`, trusted manual or lastDiscovered + stored TLS pin → `connect`; then `refreshChat` / sessions bootstrap.
3. Remove: PostOnboardingTabs `TopStatusBar` (connection logic kept, not shown); ChatErrorRail rendering; ChatComposer Thinking / Stop / Abort / orange banner entire row.
4. Empty/hint copy must **not** say 「请先在我的→连接网关」; may hint pull-to-reconnect. Me→连接网关 diagnostic entry may remain.
5. Do **not** touch: Agent Strip / TO: / 打开成果, four-tab routing, Knowledge destub, Tasks/Me big changes, new gateway RPC.

| File | What it must show |
| --- | --- |
| `A-chat-tab-chrome-clean.png` | Full chat tab: no top offline bar, no error rail, no Thinking/orange row; strip + composer + 「打开成果」 still present (`DEMO_DELIVERABLE`). |
| `B-pull-to-refresh-frame.png` | Pull-to-refresh reconnect indicator frame on empty chat (offline DEMO). |
| `B-empty-pull-hint.png` | Supplemental: empty hint copy 「网关未连接。下拉可尝试重新连接。」 |

## TODO

- [x] A — full chat chrome clean + 打开成果 retained
- [x] B — pull-to-refresh frame + empty hint
- [x] CAPTURE.md discloses DEMO extras
- [x] assembleDebug OK
