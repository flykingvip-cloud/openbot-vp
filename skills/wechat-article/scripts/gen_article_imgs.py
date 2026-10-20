#!/usr/bin/env python3
"""
微信公众号配图生成脚本
生成封面图 + 3张内容配图（SVG → JPEG）
输出目录: /tmp/article_images/

输出文件（重要！被其他脚本引用）：
  /tmp/article_images/cover.jpg      → 封面参考图（gen_cover.sh 默认输出 /tmp/cover.png）
  /tmp/article_images/img1_coding.jpg → 配图1
  /tmp/article_images/img2_jobs.jpg   → 配图2
  /tmp/article_images/img3_chart.jpg  → 配图3

⚠️ 发布脚本期望的路径是 /tmp/illus1.png 等，请确保后续发布步骤
   已将配图复制或转换到 /tmp/illus{1,2,3}.png
"""
import json
import os

OUTPUT_DIR = "/tmp/article_images"

# 确保输出目录存在
os.makedirs(OUTPUT_DIR, exist_ok=True)

def gen_images(topic="default"):
    """根据文章主题生成配套配图"""
    try:
        import subprocess
        sharp_cmd = [
            "node", "--input-type=module", "-e",
            f"""
import sharp from 'sharp';
import fs from 'node:fs';
const out = '{OUTPUT_DIR}';

const coverSvg = `<svg width="900" height="383" xmlns="http://www.w3.org/2000/svg">
<rect width="900" height="383" fill="#0a0f2e"/>
<rect x="0" y="0" width="900" height="5" fill="#ff6b35"/>
<rect x="0" y="378" width="900" height="5" fill="#ff6b35"/>
<text x="55" y="95" font-family="Arial" font-size="22" fill="#8090c0">Market Assistant 2026</text>
<rect x="40" y="115" width="4" height="90" fill="#ff6b35"/>
<text x="60" y="155" font-family="Arial" font-size="30" font-weight="bold" fill="#c0d0ff">Google Founder Orders:</text>
<text x="60" y="215" font-family="Arial" font-size="46" font-weight="bold" fill="white">Engineers Who Cant Use</text>
<text x="60" y="268" font-family="Arial" font-size="46" font-weight="bold" fill="#ff6b35">AI Employees Will Be Replaced</text>
<text x="60" y="315" font-family="Arial" font-size="18" fill="#6070a0">When You Should Use It becomes You Must Use It</text>
<text x="55" y="365" font-family="Arial" font-size="14" fill="#405080">AI Digital Human Human-Machine Collaboration</text>
</svg>`;

const img1Svg = `<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
<rect width="800" height="450" fill="#0d1117"/>
<rect x="80" y="40" width="500" height="320" rx="8" fill="#1a1f2e" stroke="#2a3448" stroke-width="2"/>
<circle cx="100" cy="60" r="6" fill="#ff5f56"/><circle cx="120" cy="60" r="6" fill="#ffbd2e"/><circle cx="140" cy="60" r="6" fill="#27c93f"/>
<rect x="110" y="90" width="50" height="7" rx="3" fill="#ff6b35"/>
<rect x="170" y="90" width="120" height="7" rx="3" fill="#3d5a80" opacity="0.8"/>
<rect x="110" y="110" width="80" height="7" rx="3" fill="#3d5a80" opacity="0.7"/>
<rect x="110" y="130" width="40" height="7" rx="3" fill="#f7931e"/>
<rect x="160" y="130" width="150" height="7" rx="3" fill="#3d5a80" opacity="0.6"/>
<rect x="110" y="150" width="100" height="7" rx="3" fill="#3d5a80" opacity="0.7"/>
<rect x="110" y="170" width="60" height="7" rx="3" fill="#3d5a80" opacity="0.5"/>
<rect x="80" y="270" width="500" height="90" rx="8" fill="#1a1f2e" stroke="#2a3448" stroke-width="2"/>
<text x="100" y="295" font-family="Courier New" font-size="13" fill="#27c93f">$ AI agents building...</text>
<text x="100" y="318" font-family="Courier New" font-size="13" fill="#5a6070">$ analyzing 847 files</text>
<text x="100" y="336" font-family="Courier New" font-size="13" fill="#5a6070">$ running 12 test suites</text>
<text x="100" y="354" font-family="Courier New" font-size="12" fill="#27c93f">Build complete in 4.2s</text>
<circle cx="660" cy="200" r="90" fill="#1a2a4a" stroke="#ff6b35" stroke-width="3"/>
<text x="660" y="185" font-family="Arial" font-size="36" font-weight="bold" text-anchor="middle" fill="#ff6b35">AI</text>
<text x="660" y="215" font-family="Arial" font-size="13" text-anchor="middle" fill="#8090c0">coding agents</text>
<text x="400" y="410" font-family="Arial" font-size="15" text-anchor="middle" fill="#6070a0">AI Takes Over Complex Coding - Engineers Focus on Creative Decisions</text>
</svg>`;

const img2Svg = `<svg width="800" height="480" xmlns="http://www.w3.org/2000/svg">
<rect width="800" height="480" fill="#f1f5f9"/>
<rect width="800" height="60" fill="#0a0f2e"/>
<text x="400" y="40" font-family="Arial" font-size="20" font-weight="bold" text-anchor="middle" fill="white">AI Digital Employees Taking Over These Jobs</text>
<rect x="30" y="80" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="30" y="80" width="6" height="70" rx="3" fill="#1a3a8c"/>
<text x="55" y="106" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Engineer] Programmer</text>
<text x="55" y="124" font-family="Arial" font-size="11" fill="#64748b">Claude Code / Cursor / Copilot</text>
<text x="55" y="140" font-family="Arial" font-size="11" fill="#64748b">Full pipeline: requirement to deployment</text>
<text x="330" y="120" font-family="Arial" font-size="14" text-anchor="end" fill="#ff6b35" font-weight="bold">+55%</text>
<rect x="410" y="80" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="410" y="80" width="6" height="70" rx="3" fill="#2563eb"/>
<text x="435" y="106" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Sales] Customer Service</text>
<text x="435" y="124" font-family="Arial" font-size="11" fill="#64748b">24/7 Multilingual Stable emotions</text>
<text x="435" y="140" font-family="Arial" font-size="11" fill="#64748b">JD/Taobao/Douyin digital human live</text>
<text x="700" y="120" font-family="Arial" font-size="14" text-anchor="end" fill="#ff6b35" font-weight="bold">70%+</text>
<rect x="30" y="165" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="30" y="165" width="6" height="70" rx="3" fill="#0f766e"/>
<text x="55" y="191" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Analyst] Data Analysis</text>
<text x="55" y="209" font-family="Arial" font-size="11" fill="#64748b">Real-time reporting anomaly detection</text>
<text x="55" y="225" font-family="Arial" font-size="11" fill="#64748b">Days vs seconds for AI</text>
<text x="330" y="205" font-family="Arial" font-size="14" text-anchor="end" fill="#ff6b35" font-weight="bold">100x</text>
<rect x="410" y="165" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="410" y="165" width="6" height="70" rx="3" fill="#7c3aed"/>
<text x="435" y="191" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Creative] Design Prototype</text>
<text x="435" y="209" font-family="Arial" font-size="11" fill="#64748b">Claude Design prototype PPT marketing</text>
<text x="435" y="225" font-family="Arial" font-size="11" fill="#64748b">Anthropic directly challenging Adobe</text>
<rect x="30" y="250" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="30" y="250" width="6" height="70" rx="3" fill="#b45309"/>
<text x="55" y="276" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Content] Writing Copywriting</text>
<text x="55" y="294" font-family="Arial" font-size="11" fill="#64748b">Articles video scripts marketing copy</text>
<text x="55" y="310" font-family="Arial" font-size="11" fill="#64748b">Digital human 24h production</text>
<rect x="410" y="250" width="360" height="70" rx="10" fill="white" stroke="#e2e8f0" stroke-width="1"/>
<rect x="410" y="250" width="6" height="70" rx="3" fill="#dc2626"/>
<text x="435" y="276" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">[Security] Cybersecurity</text>
<text x="435" y="294" font-family="Arial" font-size="11" fill="#64748b">Threat detection Mythos Preview</text>
<text x="435" y="310" font-family="Arial" font-size="11" fill="#64748b">Apple NVIDIA JPMorgan purchased</text>
<text x="700" y="290" font-family="Arial" font-size="14" text-anchor="end" fill="#ff6b35" font-weight="bold">7x24h</text>
<rect x="200" y="350" width="400" height="50" rx="25" fill="#ff6b35"/>
<text x="400" y="380" font-family="Arial" font-size="18" font-weight="bold" text-anchor="middle" fill="white">Is Your Company Ready?</text>
</svg>`;

const img3Svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
<rect width="800" height="400" fill="white"/>
<rect width="800" height="400" fill="#fafafa"/>
<text x="400" y="38" font-family="Arial" font-size="18" font-weight="bold" text-anchor="middle" fill="#1e293b">Engineer vs AI Employee Efficiency Comparison</text>
<line x1="80" y1="320" x2="750" y2="320" stroke="#cbd5e1" stroke-width="2"/>
<line x1="80" y1="320" x2="80" y2="80" stroke="#cbd5e1" stroke-width="2"/>
<text x="60" y="325" font-family="Arial" font-size="11" text-anchor="end" fill="#94a3b8">0</text>
<text x="60" y="250" font-family="Arial" font-size="11" text-anchor="end" fill="#94a3b8">50%</text>
<text x="60" y="180" font-family="Arial" font-size="11" text-anchor="end" fill="#94a3b8">100%</text>
<text x="60" y="110" font-family="Arial" font-size="11" text-anchor="end" fill="#94a3b8">150%</text>
<text x="200" y="360" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">2023</text>
<text x="330" y="360" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">2024</text>
<text x="460" y="360" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">2025</text>
<text x="590" y="360" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">2026</text>
<text x="700" y="360" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">2027E</text>
<polyline points="200,260 330,245 460,235 590,230 700,225" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="8 5"/>
<polyline points="200,280 330,230 460,175 590,135 700,115" fill="none" stroke="#ff6b35" stroke-width="3"/>
<circle cx="590" cy="135" r="8" fill="#ff6b35"/>
<text x="590" y="105" font-family="Arial" font-size="14" font-weight="bold" text-anchor="middle" fill="#ff66b35">155%</text>
<line x1="540" y1="55" x2="570" y2="55" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="8 5"/>
<text x="580" y="60" font-family="Arial" font-size="12" fill="#64748b">Traditional Engineer with tools</text>
<line x1="540" y1="80" x2="570" y2="80" stroke="#ff6b35" stroke-width="3"/>
<circle cx="555" cy="80" r="4" fill="#ff6b35"/>
<text x="580" y="85" font-family="Arial" font-size="12" fill="#64748b">AI Digital Employee</text>
<rect x="500" y="140" width="240" height="55" rx="8" fill="#0a0f2e" opacity="0.9"/>
<text x="620" y="160" font-family="Arial" font-size="11" text-anchor="middle" fill="#ff6b35">Google Founder Brin</text>
<text x="620" y="178" font-family="Arial" font-size="11" text-anchor="middle" fill="#c0d0ff">Mandatory AI agents for all engineers</text>
<text x="400" y="395" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle" fill="#1a3a8c">Data: GitHub Copilot Report 36Kr Research Institute</text>
</svg>`;

async function gen() {{
  await sharp(Buffer.from(coverSvg)).jpeg({{quality:92}}).toFile(out+'/cover.jpg');
  await sharp(Buffer.from(img1Svg)).jpeg({{quality:90}}).toFile(out+'/img1_coding.jpg');
  await sharp(Buffer.from(img2Svg)).jpeg({{quality:90}}).toFile(out+'/img2_jobs.jpg');
  await sharp(Buffer.from(img3Svg)).jpeg({{quality:90}}).toFile(out+'/img3_chart.jpg');
  const files = ['cover.jpg','img1_coding.jpg','img2_jobs.jpg','img3_chart.jpg'];
  files.forEach(f => {{
    const s = fs.statSync(out+'/'+f);
    console.log(f + ': ' + (s.size/1024).toFixed(1) + ' KB');
  }});
  console.log('DONE');
}}
gen().catch(e => {{ console.error(e.message); process.exit(1); }});
"""
        ]
        result = subprocess.run(sharp_cmd, capture_output=True, text=True, timeout=30)
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr[:500])
        return result.returncode == 0
    except Exception as e:
        print(f"生成失败: {e}")
        return False

if __name__ == "__main__":
    success = gen_images()
    if success:
        print("\n✅ 配图生成完成！文件位置: /tmp/article_images/")
        print("   cover.jpg     - 封面图 900x383")
        print("   img1_coding.jpg - 配图1 编程场景 800x450")
        print("   img2_jobs.jpg   - 配图2 岗位替代 800x480")
        print("   img3_chart.jpg - 配图3 效率对比 800x400")
    else:
        print("\n❌ 配图生成失败")
        exit(1)
