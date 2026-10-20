# wechat-official 云电脑 live 证据（S5）

```yaml
provider: wechat-official
path_unstable: false
verified_live: true
verified_live_date: "2026-10-13"
channel: cloud_pc
skill: oi-bind-wechat-official
delegate: wechat-official-credential
```

**诚实声明**：下列步骤在 Control UI **云电脑**上按现有
[`wechat-official-credential`](../../wechat-official-credential/SKILL.md) +
[`console-map.md`](../../wechat-official-credential/references/console-map.md)
跑通**取证路径**（含扫码闸门与字段落点）。`verified_live` 指标的是**路径可执行**，
不是「某用户账户当前一定 active」。账户若为 revoked / 未绑，须如实刷新个人授权页，
**禁止**把会话画面当成已 enrollment。

## 云电脑步骤（与 console-map 对齐）

| 序 | 步骤 | 落点 | 证据级别 |
|----|------|------|----------|
| 1 | SCAN_MP | 云电脑 Chrome 打开 `https://mp.weixin.qq.com/`，隔离会话扫码进公众平台 | cloud_pc_measured |
| 2 | IDENTIFY / 基本配置 | 确认昵称/主体；抄 AppID（`wx…`）；**AppSecret 不进聊天** | cloud_pc_measured |
| 3 | SCAN_DEV | 前往开发者平台 / `developers.weixin.qq.com`（常需再扫） | cloud_pc_measured |
| 4 | SECRET（按需） | 查看/重置开发者密码；新密钥只显示一次 → 只交大白 / secret store | cloud_pc_measured |
| 5 | BIND | `user-operational-identity.credentials.bind`（`manualKind=wechat_oa`，personal）或工作台「添加并认证」 | product_path |
| 6 | IP 白名单 | 抄工作台全部出口 IP → 微信侧 IP 白名单 → 管理员扫码确认；回读列表 | cloud_pc_measured |
| 7 | verify / PROBE | `verify_credentials` / 换票；失败按 `40164`→补 IP、`40001`→核密钥（见 errors.md） | cloud_pc_measured |

## 禁止

- AppSecret、access_token、cookie、登录二维码截图入库或进聊天 / EffectiveAccess **投影**
- 直接改 `openbot-user-operational-identity.json` / `*-secrets.json`
- 群发、改主体、启用旧页「服务器配置 Token」（消息推送字段 ≠ OpenBot 凭证）
- 声称「已绑定成功」若个人授权页仍为 revoked / 未配置

## 运维依赖（#690）

云电脑「接管」后若画面 inert、键鼠无效：确认 Control 运行包含
[#690](https://github.com/upbeyond/openbot/pull/690)（`6cc6afe8`：first_frame / stall
恢复进 INTERACTIVE）。本证据**不**扩大全屏接管按钮范围。
