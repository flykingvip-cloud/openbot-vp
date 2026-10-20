#!/usr/bin/env python3
"""
即梦（Jimeng）AI 视频生成脚本
支持文生视频和图生视频，兼容 OpenAI 格式
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = os.environ.get("JIMENG_API_BASE", "https://api.newcoin.tech/v1")
API_KEY = os.environ.get("JIMENG_API_KEY", "")


def slugify(text: str) -> str:
    import re
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:40] or "video"


def default_output_dir() -> Path:
    now = dt.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    base = Path.home() / "Projects" / "tmp"
    base.mkdir(parents=True, exist_ok=True)
    out = base / f"jimeng-video-{now}"
    out.mkdir(parents=True, exist_ok=True)
    return out


def api_request(endpoint: str, payload: dict) -> dict:
    url = f"{API_BASE.rstrip('/')}/{endpoint.lstrip('/')}"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        data=body,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        payload_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API 请求失败 ({e.code}): {payload_text}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"网络错误: {e.reason}") from e


def get_task_status(task_id: str) -> dict:
    """查询任务状态"""
    url = f"{API_BASE.rstrip('/')}/video/generations/{task_id}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        payload_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"查询任务失败 ({e.code}): {payload_text}") from e


def wait_for_completion(task_id: str, timeout: int = 300) -> dict:
    """阻塞等待视频生成完成"""
    interval = 5
    elapsed = 0
    while elapsed < timeout:
        result = get_task_status(task_id)
        status = result.get("status", "")
        print(f"  状态: {status}  (已等待 {elapsed}s)")
        if status == "completed":
            return result
        elif status in ("failed", "error"):
            raise RuntimeError(f"任务失败: {json.dumps(result, ensure_ascii=False)}")
        time.sleep(interval)
        elapsed += interval
    raise RuntimeError(f"等待超时（{timeout}s），任务 ID: {task_id}")


def download_video(url: str, out_path: Path) -> None:
    """下载视频文件"""
    try:
        urllib.request.urlretrieve(url, out_path)
        print(f"  下载完成: {out_path}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"视频下载失败: {e.reason}") from e


def create_video(text_prompt: str, image_path: str, model: str, duration: str,
                 aspect: str, output_dir: Path, wait: bool, timeout: int) -> dict:
    """创建视频生成任务"""

    # 构建请求参数
    payload: dict = {
        "model": model,
    }

    if image_path:
        # 图生视频模式
        if image_path.startswith("http://") or image_path.startswith("https://"):
            payload["image_url"] = image_path
        else:
            # 本地图片 → base64
            img_path = Path(image_path).expanduser()
            if not img_path.exists():
                raise FileNotFoundError(f"图片不存在: {img_path}")
            import base64
            with open(img_path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode("utf-8")
            ext = img_path.suffix.lstrip(".").lower()
            mime = f"image/{ext}" if ext in ("jpg", "jpeg", "png", "webp") else "image/png"
            payload["image_data"] = f"data:{mime};base64,{img_b64}"
        payload["prompt"] = text_prompt
    else:
        # 文生视频模式
        payload["prompt"] = text_prompt

    # 视频参数
    if duration:
        payload["duration"] = duration
    if aspect:
        payload["aspect_ratio"] = aspect

    print(f"创建视频任务:")
    print(f"  模型: {model}")
    print(f"  描述: {text_prompt}")
    if image_path:
        print(f"  参考图: {image_path}")
    if duration:
        print(f"  时长: {duration}")
    if aspect:
        print(f"  比例: {aspect}")

    result = api_request("video/generations", payload)
    task_id = result.get("id") or result.get("task_id", "")
    print(f"\n任务已提交: {task_id}")

    meta_path = output_dir / "task_meta.json"
    meta = {
        "task_id": task_id,
        "model": model,
        "prompt": text_prompt,
        "image": image_path,
        "duration": duration,
        "aspect": aspect,
        "status": "submitted",
        "submitted_at": dt.datetime.now().isoformat(),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"元数据已保存: {meta_path}")

    if wait:
        print("\n等待生成完成...")
        final = wait_for_completion(task_id, timeout)
        status = final.get("status")
        meta["status"] = status
        meta["completed_at"] = dt.datetime.now().isoformat()

        # 下载视频
        video_url = ""
        if status == "completed":
            # 尝试多个可能的字段名
            video_url = (
                final.get("data", {})
                .get("video", {})
                .get("url")
                or final.get("video_url")
                or final.get("url")
                or ""
            )
            if video_url:
                ext = "mp4"
                filename = f"{slugify(text_prompt)}.{ext}"
                out_path = output_dir / filename
                download_video(video_url, out_path)
                meta["video_file"] = str(out_path)
                meta["video_url"] = video_url

        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        if status == "completed" and video_url:
            print(f"\n✅ 视频生成完成！")
            print(f"   文件: {out_path}")
        else:
            print(f"\n⚠️ 生成完成但未获取到视频 URL，请手动查询任务 {task_id}")
            print(f"   响应: {json.dumps(final, ensure_ascii=False)[:500]}")

    else:
        print(f"\n任务已提交，ID: {task_id}")
        print(f"查询进度: python3 gen_video.py --task-id {task_id} --wait")

    return meta


def main() -> int:
    ap = argparse.ArgumentParser(description="即梦 AI 视频生成 - 文生视频 / 图生视频")
    ap.add_argument("--prompt", help="视频描述文本（必填）")
    ap.add_argument("--image", help="参考图片路径或 URL（图生视频必填）")
    ap.add_argument("--model", default="jimeng-video-3.5-pro", help="视频模型: jimeng-video-3.5-pro / jimeng-video-3.0-pro 等（默认 jimeng-video-3.5-pro）")
    ap.add_argument("--duration", default="5", help="视频时长: 5s / 10s（默认 5s）")
    ap.add_argument("--aspect", default="16:9", help="画面比例: 16:9 / 9:16 / 1:1（默认 16:9）")
    ap.add_argument("--output", default="", help=f"输出目录（默认 ~/Projects/tmp/jimeng-video-YYYY-MM-DD-HH-MM-SS/）")
    ap.add_argument("--task-id", help="查询已有任务状态")
    ap.add_argument("--wait", action="store_true", help="阻塞等待直到视频生成完成")
    ap.add_argument("--timeout", type=int, default=300, help="等待超时秒数（默认 300）")
    args = ap.parse_args()

    # 检查 API Key
    if not API_KEY:
        print("❌ 错误: 未设置 JIMENG_API_KEY 环境变量", file=sys.stderr)
        print("请运行: export JIMENG_API_KEY=\"sk-xxx\"", file=sys.stderr)
        return 1

    if args.task_id:
        # 查询模式
        print(f"查询任务: {args.task_id}")
        result = get_task_status(args.task_id)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    # 创建模式
    if not args.prompt:
        print("❌ 错误: --prompt 必填", file=sys.stderr)
        return 1

    output_dir = Path(args.output) if args.output else default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        create_video(
            text_prompt=args.prompt,
            image_path=args.image or "",
            model=args.model,
            duration=args.duration,
            aspect=args.aspect,
            output_dir=output_dir,
            wait=args.wait,
            timeout=args.timeout,
        )
        return 0
    except Exception as e:
        print(f"❌ 错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
