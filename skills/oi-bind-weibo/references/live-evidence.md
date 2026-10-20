# weibo live 证据（S5 承继 + S6 复核）

```yaml
provider: weibo
path_unstable: true
verified_live: false
live_probe_date: "2026-10-19"
prior_measured_date: "2026-10-13"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
prior_channel: cloud_pc
skill: oi-bind-weibo
```

**诚实声明**：S5（2026-10-13）Cloud PC 已 **measured** GeeTest /
错误码 **111001**，但 Access Token 绑定**未** live 成功。S6（2026-10-19）
本机复核：无新的云电脑会话、无 bind 成功 → **保持**
`path_unstable: true` / `verified_live: false`。measured ≠ verified_live。

## E2E 条目 A — S5 Cloud PC（2026-10-13，承继）

| 序 | 步骤 | 环境 | 结果 |
|----|------|------|------|
| 1 | 云电脑 Chrome 打开微博登录 / 开放平台 | Cloud PC | measured |
| 2 | GeeTest「请先验证身份」`security.weibo.com/captcha/geetest` | Cloud PC | measured |
| 3 | 错误码 **111001**「请重新尝试」 | Cloud PC | measured（阻断） |
| 4 | 越过验证 → 取 Token → `credentials.bind` | Cloud PC | **未达** |

详见 [path-map.md](path-map.md)。

## E2E 条目 B — S6 本地复核（2026-10-19）

| 序 | 步骤 | 环境 | 结果 |
|----|------|------|------|
| 1 | 复核 path-map / S5 证据与闸门 | Mac worktree | ok |
| 2 | 再开 Cloud PC 越过 111001 并 bind | Cloud PC | **阻断**：本切片无云电脑会话 |
| 3 | `credentials.bind` 成功 | gateway | **未执行** |

## 失败点

- S5：111001 / GeeTest 死循环级阻断。  
- S6：无 Cloud PC 续跑；无真实 Token。

## 翻旗前置（尚未满足）

1. 人机验证越过（非 111001 死循环）  
2. 取得可用 Access Token / Cookie（不进聊天）  
3. `credentials.bind` 成功且 weibo=active  
4. 回写成功步骤后再允许翻旗

## 禁止

因见到验证码页宣称路径已打通；伪造 verified_live；密钥进 PR/聊天/投影。
