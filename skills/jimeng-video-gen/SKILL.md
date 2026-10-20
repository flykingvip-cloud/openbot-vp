---
name: jimeng-video-gen
description: 即梦（Jimeng）AI 视频生成：文生视频、图生视频。支持 jimeng-5.0、jimeng-4.6、jimeng-4.5 模型。兼容 OpenAI 格式 API，调用地址 https://api.newcoin.tech/v1/video/generations。环境变量 JIMENG_API_KEY / JIMENG_API_BASE。用于：生成短视频、动画、广告片、创意内容。
---

# 即梦视频生成（jimeng-video-gen）

基于即梦（Jimeng）的 AI 视频生成 API，支持**文生视频**和**图生视频**。

## 配置

```bash
# 设置 API 密钥（必填）
export JIMENG_API_KEY="sk-RTtP1GoEsJi4nkmAc6JUaXSIBpdgj7YuKFtMysQcf4BJyLk3"

# 可选：自定义 API 地址（默认已配置）
export JIMENG_API_BASE="https://api.newcoin.tech/v1"
```

## 使用方法

### 1. 文生视频（text-to-video）

```bash
python3 ~/AI项目/openbot/skills/jimeng-video-gen/scripts/gen_video.py \
  --prompt "一只橘猫在阳光下打盹" \
  --model jimeng-4.6
```

### 2. 图生视频（image-to-video）

```bash
python3 ~/AI项目/openbot/skills/jimeng-video-gen/scripts/gen_video.py \
  --image "~/photo.png" \
  --prompt "风吹过，树叶轻轻摇动" \
  --model jimeng-4.6
```

### 3. 查看生成状态 / 下载视频

```bash
python3 ~/AI项目/openbot/skills/jimeng-video-gen/scripts/gen_video.py \
  --task-id "task_xxxxxxxx" \
  --wait
```

## 可用模型

### 视频生成模型

| 模型                       | 说明                       |
| -------------------------- | -------------------------- |
| `jimeng-video-3.5-pro`     | 旗舰版，效果最好，推荐使用 |
| `jimeng-video-3.5-pro-10s` | 旗舰版，10 秒              |
| `jimeng-video-3.5-pro-12s` | 旗舰版，12 秒              |
| `jimeng-video-3.0-pro`     | 专业版                     |
| `jimeng-video-3.0-pro-10s` | 专业版，10 秒              |
| `jimeng-video-3.0`         | 标准版                     |
| `jimeng-video-3.0-10s`     | 标准版，10 秒              |

### 图片生成模型

| 模型         | 说明     |
| ------------ | -------- |
| `jimeng-5.0` | 效果最好 |
| `jimeng-4.6` | 推荐使用 |
| `jimeng-4.5` | 稳定版   |
| `jimeng-4.0` | 早期版   |

> ⚠️ `jimeng-5.0/4.6/4.5` 是**图片生成**模型，不是视频模型。视频生成请用 `jimeng-video-3.0` / `jimeng-video-3.5-pro` 系列。

## 脚本参数

```text
--prompt     视频描述文本（文生视频必填）
--image      参考图片路径（图生视频必填，支持 URL 或本地路径）
--model      模型名称（默认 jimeng-4.6）
--duration   视频时长（5s / 10s，默认 5s）
--aspect     画面比例（16:9 / 9:16 / 1:1，默认 16:9）
--output     输出文件路径（默认 ./jimeng_output/)
--task-id    查看已有任务的进度和结果
--wait       阻塞等待直到视频生成完成
--timeout    等待超时秒数（默认 300）
```

## 输出

- 视频文件：`output/*.mp4`
- 元数据：`output/task_meta.json`（包含 task_id、状态、URL）
- 日志：`output/task.log`

详细 API 说明见 [references/api.md](references/api.md)。
