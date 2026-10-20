# xiaohongshu live 证据（S6）

```yaml
provider: xiaohongshu
path_unstable: true
verified_live: false
live_probe_date: "2026-10-19"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
skill: oi-bind-xiaohongshu
```

**诚实声明**：S6（2026-10-19 Asia/Shanghai）在本机 Mac worktree
`openbot-oi-intelligent-bind-s6` 记录取证尝试。本切片**无**可用 Control UI
云电脑会话，**无**真实小红书 Access Token 可供
`user-operational-identity.credentials.bind`。因此 **保持**
`path_unstable: true` / `verified_live: false`。禁止空口翻旗。

## E2E 尝试（2026-10-19）

| 序 | 步骤 | 环境 | 结果 |
|----|------|------|------|
| 1 | 确认 skill / path-map / 公开入口 `https://open.xiaohongshu.com/` | Mac worktree | ok（public_docs） |
| 2 | 连接 Control UI 云电脑跑登录→Token→bind | Cloud PC | **阻断**：本切片无云电脑会话 |
| 3 | 使用真实 accountHandle + accessToken 调 `credentials.bind` | gateway OI API | **未执行**（无真实凭证；禁伪造） |
| 4 | 个人授权页 xiaohongshu=active | 产品 UI | **未达** |

## 失败点 / 阻断

- Cloud PC / 真机隔离会话不可用（S6 本地实现切片）。  
- 无合规真实 Token；不得把密钥写进本文件或 PR。  
- 菜单点击序、扫码/2FA、Token 控件仍多为 path-map `UNKNOWN`。

## 翻旗前置（尚未满足）

1. 云电脑或等价真机登录开放平台 / 创作者后台  
2. 取得可用 Access Token（只经 secret store）  
3. `credentials.bind` 成功且个人授权页 active  
4. 将成功步骤回写本文件后再允许 `verified_live: true`

## 禁止

- 伪造 `verified_live: true`；密钥/Cookie/Token 进聊天 / PR / 投影  
- 直接改 OI JSON；用会话画面冒充已 enrollment
