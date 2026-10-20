# 即梦（Jimeng）API 参考

## 基础信息

- **API 地址**: `https://api.newcoin.tech/v1`
- **认证**: `Authorization: Bearer <API_KEY>`
- **格式**: OpenAI 兼容

## 端点

### 创建视频任务

```
POST /v1/video/generations
```

**请求体**:

```json
{
  "model": "jimeng-4.6",
  "prompt": "一只橘猫在阳光下打盹",
  "duration": "5",
  "aspect_ratio": "16:9"
}
```

图生视频时:

```json
{
  "model": "jimeng-4.6",
  "prompt": "风吹过，树叶轻轻摇动",
  "image_url": "https://example.com/photo.png",
  "duration": "5"
}
```

或使用 base64:

```json
{
  "model": "jimeng-4.6",
  "prompt": "风吹过",
  "image_data": "data:image/png;base64,iVBORw0KGgo...",
  "duration": "5"
}
```

**响应**:

```json
{
  "id": "task_8a7b6c5d4e3f2g1h",
  "status": "pending",
  "model": "jimeng-4.6"
}
```

### 查询任务状态

```
GET /v1/video/generations/{task_id}
```

**响应（完成时）**:

```json
{
  "id": "task_8a7b6c5d4e3f2g1h",
  "status": "completed",
  "data": {
    "video": {
      "url": "https://cdn.jimeng.com/output/xxx.mp4"
    }
  }
}
```

## 可用模型

| 模型         | 说明             |
| ------------ | ---------------- |
| `jimeng-5.0` | 最新版，效果最好 |
| `jimeng-4.6` | 推荐，稳定       |
| `jimeng-4.5` | 早期版本         |

## 参数

| 参数           | 类型   | 说明                          |
| -------------- | ------ | ----------------------------- |
| `prompt`       | string | 视频描述文本                  |
| `model`        | string | 模型 ID                       |
| `duration`     | string | 时长: "5" 或 "10"             |
| `aspect_ratio` | string | 比例: "16:9" / "9:16" / "1:1" |
| `image_url`    | string | 参考图 URL（图生视频）        |
| `image_data`   | string | base64 图片数据（图生视频）   |

## 状态值

| 状态         | 说明         |
| ------------ | ------------ |
| `pending`    | 等待处理     |
| `processing` | 生成中       |
| `completed`  | 完成，可下载 |
| `failed`     | 失败         |
| `error`      | 错误         |
