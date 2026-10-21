# 零停机部署方案

## 问题背景

传统部署流程：`stop old → start new`，在容器切换期间（15-70秒）端口 18789 不可用，nginx 返回 `connection refused`，导致所有 WebSocket 客户端断连（`code=1006`）。

## 解决方案

采用**双端口热切换**策略：新容器先在临时端口 18790 启动并通过健康检查，然后 nginx 切换流量到新端口，最后停止旧容器。整个过程端口连续可用，实现零停机。

## 流程图

```
传统流程（有停机窗口）：
  stop old(18789) ─┬─ 15-70s 空窗 ─┬─> start new(18789)
                   └─ nginx: 502 ───┘

零停机流程（双端口切换）：
  1. old(18789) running        ← 保持服务
  2. start new(18790)          ← 新容器启动
  3. health check new(18790)   ← 确保就绪
  4. nginx: 18789 → 18790      ← 切换流量（reload，无中断）
  5. stop old(18789)           ← 停旧容器
  6. rename new → 18789        ← 恢复标准配置
```

## 使用方法

### 1. 准备新镜像

按现有流程构建新镜像：

```bash
# 在本地仓库
git fetch origin
git checkout <target-sha>
pnpm build

# 打包（包含完整 node_modules）
tar czf /tmp/openbot-runtime-<sha>-v2.tar.gz \
  dist/ node_modules/ openbot.mjs openclaw.mjs package.json pnpm-lock.yaml

# 传输到云端
scp /tmp/openbot-runtime-<sha>-v2.tar.gz root@8.217.93.71:/tmp/

# 在云端构建镜像
ssh root@8.217.93.71
mkdir -p /tmp/openbot-build-<sha>
cd /tmp/openbot-build-<sha>
tar xzf /tmp/openbot-runtime-<sha>-v2.tar.gz

cat > Dockerfile << 'EOF'
FROM node:22-slim
WORKDIR /app
COPY . .
EXPOSE 18789
EOF

podman build -t localhost/openbot:rc-amd64-provenance-<sha> .
```

### 2. 执行零停机切换

```bash
# 在云端主机
cd /tmp/openbot-build-<sha>
/path/to/zero-downtime-cutover.sh localhost/openbot:rc-amd64-provenance-<sha>
```

脚本会自动执行 7 个步骤，整个过程约 10-15 秒，**对用户无感知**。

### 3. 验证部署

```bash
# 检查新容器
podman ps | grep openbot-gateway-rc

# 检查版本
podman exec openbot-gateway-rc cat /app/dist/build-info.json | jq -r .commit

# 测试公网连接
curl -s https://openbot.love/health | jq

# 查看 WebSocket 日志（应该没有异常断连）
podman logs openbot-gateway-rc --since 5m | grep -i "1006\|disconnect"
```

## 技术细节

### Nginx upstream 动态切换

零停机的核心是 nginx upstream 支持多服务器配置：

```nginx
# 步骤 3-4：临时双端口配置
upstream openbot_gateway {
    server 127.0.0.1:18790;       # 新容器（主）
    server 127.0.0.1:18789 backup; # 旧容器（备用）
    keepalive 32;
}
```

`nginx -s reload` 是平滑重载，已有连接保持，新连接使用新配置。

### 容器重命名策略

旧容器改名为 `openbot-gateway-rc-old-<timestamp>`，保留 24 小时以便回滚：

```bash
# 如需紧急回滚
podman stop openbot-gateway-rc
podman rename openbot-gateway-rc-old-20261004-150000 openbot-gateway-rc
podman start openbot-gateway-rc

# 恢复 nginx 配置到旧端口
# （脚本已在步骤 7 恢复标准配置，通常无需手动操作）
```

### 端口分配

- **18789**: 标准生产端口（nginx upstream 的长期配置）
- **18790**: 临时切换端口（仅在部署期间使用 10-15 秒）

### 健康检查

脚本在步骤 2 等待 `/health` 端点响应，超时 60 秒自动回滚。确保新容器完全就绪再切流量。

## 回滚方案

### 自动回滚

如果新容器健康检查失败（60秒内未响应），脚本自动：

1. 停止新容器
2. 删除新容器
3. 保持旧容器运行
4. 退出并报错

### 手动回滚

如果部署后发现问题：

```bash
# 1. 立即切回旧容器（如果还在运行）
OLD_ID=$(podman ps -a --filter "name=openbot-gateway-rc-old-" --format "{{.ID}}" | head -1)
podman start "$OLD_ID"

# 2. 停止新容器
podman stop openbot-gateway-rc

# 3. 重命名
podman rename openbot-gateway-rc openbot-gateway-rc-failed
podman rename "$OLD_ID" openbot-gateway-rc

# 4. 恢复 nginx upstream
cat > /etc/nginx/conf.d/00-openbot-upstream.conf << 'EOF'
upstream openbot_gateway {
    server 127.0.0.1:18789;
    keepalive 32;
}
EOF
nginx -t && nginx -s reload
```

## 对比传统流程

| 指标       | 传统流程             | 零停机流程           |
| ---------- | -------------------- | -------------------- |
| 停机时间   | 15-70 秒             | ~0 秒                |
| 客户端断连 | 全部断连 (code=1006) | 无断连               |
| Nginx 日志 | connection refused   | 正常                 |
| 回滚难度   | 需重启旧容器         | 保留旧容器，立即切回 |
| 操作复杂度 | 低（1 步）           | 中（7 步，自动化）   |

## 监控与日志

### 内存监控

已启用轻量级监控（PID 2548040）：

- 日志：`/var/lib/openbot/memory-monitor.log`
- 频率：每小时
- 保留：最近 7 天（约 5-7KB）

```bash
# 查看当前内存
tail -5 /var/lib/openbot/memory-monitor.log

# 查看趋势
cat /var/lib/openbot/memory-monitor.log | awk '{print $1, $2, $3}'
```

### 部署日志

每次部署后更新 ledger：

```bash
# https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl
{"seq":112,"commit":"3fc06be82777","timestamp":"2026-10-04T14:30:00Z","method":"zero-downtime"}
```

## 已知限制

1. **首次使用需验证**：建议在低峰期首次执行，观察流量切换平滑度
2. **依赖 nginx reload**：nginx 必须支持平滑重载（标准配置已支持）
3. **磁盘空间**：临时双容器运行需额外 ~3GB（当前可用 7.5GB，充足）

## 未来优化

- [ ] 添加金丝雀发布（新容器先承载 10% 流量）
- [ ] 自动清理 >24 小时的旧容器
- [ ] 集成到 CI/CD（GitHub Actions 自动部署）
- [ ] 蓝绿部署（双容器常驻，流量瞬时切换）

## 参考

- 当前部署 SOP: `deploy/production/SOP-云端部署.md`
- Forward-only 检查: `deploy/production/scripts/verify-forward-only.sh`
- Release ledger: `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`
