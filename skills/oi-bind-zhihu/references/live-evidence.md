# zhihu live 证据（S6）

```yaml
provider: zhihu
path_unstable: true
verified_live: false
live_probe_date: "2026-10-19"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
related_account_computer: "PR #827 (2026-10-18)"
skill: oi-bind-zhihu
```

**诚实声明**：S6（2026-10-19）本机记录 OI 绑定取证尝试。无云电脑 OI bind 成功。
相关：**Account Computer** [#827](https://github.com/upbeyond/openbot/pull/827)
对 `zhihu.com/signin` 做了 gated live 登录页 QR/SMS detect（2026-10-18），
**不等于** `user-operational-identity.credentials.bind` 成功，**不得**据此翻
`verified_live`。保持 `path_unstable: true` / `verified_live: false`。

## E2E 条目 A — OI bind 尝试（2026-10-19）

| 序  | 步骤                                                | 环境         | 结果                                |
| --- | --------------------------------------------------- | ------------ | ----------------------------------- |
| 1   | 确认公开入口 `https://www.zhihu.com/` 与 path-map   | Mac worktree | ok（public_docs）                   |
| 2   | 云电脑取 Access Token / Cookie → `credentials.bind` | Cloud PC     | **阻断**：无云电脑会话 / 无真实凭证 |
| 3   | 个人授权页 zhihu=active                             | 产品 UI      | **未达**                            |

## E2E 条目 B — 相关 Account Computer（2026-10-18，#827，非 OI bind）

| 序  | 步骤                                                         | 环境                        | 结果                                          |
| --- | ------------------------------------------------------------ | --------------------------- | --------------------------------------------- |
| 1   | 打开 `zhihu.com/signin` 检测 App QR / SMS / 微信 OAuth popup | Worker Docker / host Chrome | measured（登录**页**可达）                    |
| 2   | 完成扫码/SMS 并取得会话 Cookie 后 OI bind                    | —                           | **未宣称**；#827 明确不宣称 completed session |
| 3   | OI `credentials.bind`                                        | —                           | **未覆盖**                                    |

见 `docs/design/account-computer-zhihu-login-e2e-acceptance-brief-2026-10-18.md`。

## 失败点 / 阻断

- OI 路径：无 Cloud PC bind；无合规 Token。
- #827 只证明登录页 detect / handoff wiring，measured ≠ OI verified_live。

## 翻旗前置（尚未满足）

1. 真机/云电脑完成知乎登录（可借助 AC handoff，但须真人扫码/SMS）
2. 取得可用于 social_account 的 Access Token / Cookie（不进聊天）
3. `credentials.bind` 成功且 zhihu=active
4. 回写成功步骤后再允许翻旗

## 禁止

把 #827 登录 detect 冒充 verified_live；密钥进 PR/聊天/投影；直接改 OI JSON。
