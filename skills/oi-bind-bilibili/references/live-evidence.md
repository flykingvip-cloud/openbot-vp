# bilibili live 证据（S6）

```yaml
provider: bilibili
path_unstable: true
verified_live: false
live_probe_date: "2026-10-19"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
skill: oi-bind-bilibili
```

**诚实声明**：S6（2026-10-19 Asia/Shanghai）本机记录取证尝试。无云电脑会话、
无真实哔哩哔哩 Token → **保持** `path_unstable: true` / `verified_live: false`。

## E2E 尝试（2026-10-19）

| 序 | 步骤 | 环境 | 结果 |
|----|------|------|------|
| 1 | 确认公开入口 `https://openhome.bilibili.com/` | Mac worktree | ok（public_docs） |
| 2 | 云电脑登录 → 取 Token → bind | Cloud PC | **阻断**：无云电脑会话 |
| 3 | `credentials.bind` | gateway | **未执行**（无真实凭证） |
| 4 | 个人授权页 bilibili=active | 产品 UI | **未达** |

## 失败点 / 阻断

Cloud PC 不可用；菜单点击序仍多为 UNKNOWN；无合规 Token。

## 翻旗前置（尚未满足）

云电脑完成登录与 Token 取证 → `credentials.bind` 成功 → 回写本文件后再翻旗。

## 禁止

伪造 verified_live；密钥进聊天/PR/投影；直接改 OI JSON。
