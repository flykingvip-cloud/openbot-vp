#!/bin/bash
# 公众号封面图生成脚本
# 使用方法: bash gen_cover.sh "主标题" "副标题" "底部标签"
# 依赖: sharp (从当前仓库 node_modules 解析)

TITLE="${1:-AI时代}"
SUBTITLE="${2:-你的工作还能撑几年}"
TAG="${3:-市场助手 | 2026}"
OUTPUT_PATH="${WECHAT_ARTICLE_COVER_OUT:-/tmp/cover.jpg}"

node --input-type=module -e "
import sharp from 'sharp';

const width = 900, height = 383;
const outputPath = process.env.WECHAT_ARTICLE_COVER_OUT || '$OUTPUT_PATH';

const svg = \`<svg width='\${width}' height='\${height}' xmlns='http://www.w3.org/2000/svg'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0%' stop-color='#0a0f2e'/>
      <stop offset='100%' stop-color='#1a3a8c'/>
    </linearGradient>
    <linearGradient id='accent' x1='0' y1='0' x2='1' y2='0'>
      <stop offset='0%' stop-color='#ff6b35'/>
      <stop offset='100%' stop-color='#f7931e'/>
    </linearGradient>
  </defs>
  <rect width='\${width}' height='\${height}' fill='url(#bg)'/>
  <rect x='0' y='0' width='\${width}' height='5' fill='url(#accent)'/>
  <rect x='0' y='\${height-5}' width='\${width}' height='5' fill='url(#accent)'/>
  <rect x='40' y='100' width='4' height='100' fill='#ff6b35'/>
  <text x='60' y='135' font-family='PingFang SC, Microsoft YaHei, sans-serif' font-size='36' font-weight='bold' fill='#ffffff'>$TITLE</text>
  <text x='60' y='195' font-family='PingFang SC, Microsoft YaHei, sans-serif' font-size='48' font-weight='bold' fill='#ff6b35'>$SUBTITLE</text>
  <text x='60' y='260' font-family='PingFang SC, Microsoft YaHei, sans-serif' font-size='20' fill='#8090c0'>AI · 数字人 · 人机协作</text>
  <text x='60' y='350' font-family='PingFang SC, Microsoft YaHei, sans-serif' font-size='16' fill='#6070a0'>$TAG</text>
</svg>\`;

async function writeCover() {
  let quality = 85;
  let buf;
  while (quality >= 35) {
    buf = await sharp(Buffer.from(svg)).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buf.length <= 64 * 1024) break;
    quality -= 10;
  }
  if (!buf || buf.length > 64 * 1024) {
    buf = await sharp(Buffer.from(svg))
      .resize({ width: 720, height: 306, fit: 'fill' })
      .jpeg({ quality: 55, mozjpeg: true })
      .toBuffer();
  }
  await sharp(buf).toFile(outputPath);
  console.log('cover written', outputPath, buf.length, 'bytes');
}
await writeCover();
"
