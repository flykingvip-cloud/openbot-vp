#!/usr/bin/env node
// Leftover. Live draft-box writes use operational_identity / user_operational_identity
// publish_draft (skills/wechat-article/references/draft-handoff.md). Do not run this
// script when an Official Account identity is already granted.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import axios from "axios";
import FormData from "form-data";

function parseArgs(argv) {
  const args = {
    config: process.env.WECHAT_CONFIG_PATH ?? "",
    title: "",
    author: "",
    digest: "",
    contentFile: "",
    cover: "/tmp/cover.png",
    images: [],
    outputJson: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--config":
        args.config = next ?? "";
        index += 1;
        break;
      case "--title":
        args.title = next ?? "";
        index += 1;
        break;
      case "--author":
        args.author = next ?? "";
        index += 1;
        break;
      case "--digest":
        args.digest = next ?? "";
        index += 1;
        break;
      case "--content-file":
      case "--html":
        args.contentFile = next ?? "";
        index += 1;
        break;
      case "--cover":
        args.cover = next ?? "";
        index += 1;
        break;
      case "--image":
        if (next) {
          args.images.push(next);
        }
        index += 1;
        break;
      case "--output-json":
        args.outputJson = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node skills/wechat-article/scripts/publish_agi_axios.js \\",
    '    --title "文章标题" \\',
    '    --author "作者" \\',
    '    --digest "摘要" \\',
    "    --content-file /abs/path/to/article.html \\",
    "    --cover /tmp/cover.png \\",
    "    --image /tmp/illus1.png --image /tmp/illus2.png --image /tmp/illus3.png",
    "",
    "Credentials:",
    "  Prefer WECHAT_APP_ID / WECHAT_APP_SECRET or WECHAT_CONFIG_PATH.",
  ].join("\n");
}

function parseConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }
  const content = fs.readFileSync(configPath, "utf8");
  const config = {};
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^(?:- )?([A-Za-z][A-Za-z0-9_ ]*):\s*(.+)\s*$/u);
    if (!match) {
      continue;
    }
    const key = match[1].replace(/\s+/gu, "");
    const value = match[2].trim();
    if (value && !value.includes("your-") && value !== "[REDACTED]") {
      config[key] = value;
    }
  }
  return config;
}

function resolveCredential(name, config) {
  const envMap = {
    AppID: "WECHAT_APP_ID",
    AppSecret: "WECHAT_APP_SECRET",
  };
  const envValue = process.env[envMap[name]]?.trim();
  if (envValue) {
    return envValue;
  }
  return typeof config[name] === "string" ? config[name].trim() : "";
}

function ensureFile(filePath, minSize = 10 * 1024) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const size = fs.statSync(filePath).size;
  if (size < minSize) {
    throw new Error(`File too small (${size} bytes): ${filePath}`);
  }
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderMarkdownParagraphs(input) {
  const lines = input.split(/\r?\n/u);
  const output = [];
  let inList = false;
  let inOrderedList = false;
  let inQuote = false;

  const closeBlocks = () => {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
    if (inOrderedList) {
      output.push("</ol>");
      inOrderedList = false;
    }
    if (inQuote) {
      output.push("</blockquote>");
      inQuote = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeBlocks();
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/u);
    if (headingMatch) {
      closeBlocks();
      const level = headingMatch[1].length + 1;
      output.push(`<h${level}>${escapeHtml(headingMatch[2].trim())}</h${level}>`);
      continue;
    }
    const listMatch = line.match(/^[-*]\s+(.*)$/u);
    if (listMatch) {
      if (!inList) {
        closeBlocks();
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${escapeHtml(listMatch[1].trim())}</li>`);
      continue;
    }
    const orderedMatch = line.match(/^\d+[.)]\s+(.*)$/u);
    if (orderedMatch) {
      if (!inOrderedList) {
        closeBlocks();
        output.push("<ol>");
        inOrderedList = true;
      }
      output.push(`<li>${escapeHtml(orderedMatch[1].trim())}</li>`);
      continue;
    }
    const quoteMatch = line.match(/^>\s?(.*)$/u);
    if (quoteMatch) {
      if (!inQuote) {
        closeBlocks();
        output.push("<blockquote>");
        inQuote = true;
      }
      output.push(`<p>${escapeHtml(quoteMatch[1].trim())}</p>`);
      continue;
    }
    closeBlocks();
    output.push(`<p>${escapeHtml(line.trim())}</p>`);
  }

  closeBlocks();
  return output.join("\n");
}

function loadContent(contentFile) {
  const raw = fs.readFileSync(contentFile, "utf8");
  const extension = path.extname(contentFile).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return raw;
  }
  return renderMarkdownParagraphs(raw);
}

function replaceImagePlaceholders(content, imageUrls) {
  return imageUrls.reduce((current, url, index) => {
    const placeholderIndex = index + 1;
    return current
      .replaceAll(`ILLUS${placeholderIndex}_URL`, url)
      .replaceAll(`{{ILLUS${placeholderIndex}_URL}}`, url);
  }, content);
}

async function getAccessToken(appId, appSecret) {
  const response = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
    params: {
      grant_type: "client_credential",
      appid: appId,
      secret: appSecret,
    },
    timeout: 20000,
  });
  if (!response.data?.access_token) {
    throw new Error(`Token request failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.access_token;
}

async function uploadMaterial(token, filePath, type) {
  const form = new FormData();
  form.append("media", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: "image/png",
  });
  const response = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=${type}`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000,
      maxBodyLength: Infinity,
    },
  );
  return response.data;
}

async function createDraft(token, article) {
  const response = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
    { articles: [article] },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    },
  );
  return response.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title || !args.author || !args.digest || !args.contentFile) {
    console.error(usage());
    process.exit(1);
  }

  ensureFile(args.contentFile, 1);
  ensureFile(args.cover);
  for (const image of args.images) {
    ensureFile(image);
  }

  const config = parseConfigFile(args.config);
  const appId = resolveCredential("AppID", config);
  const appSecret = resolveCredential("AppSecret", config);
  if (!appId || !appSecret) {
    throw new Error(
      "Missing WeChat credentials. Set WECHAT_APP_ID / WECHAT_APP_SECRET or WECHAT_CONFIG_PATH.",
    );
  }

  const token = await getAccessToken(appId, appSecret);
  const thumbResult = await uploadMaterial(token, args.cover, "thumb");
  if (!thumbResult?.media_id) {
    throw new Error(`Thumb upload failed: ${JSON.stringify(thumbResult)}`);
  }

  const imageUrls = [];
  for (const image of args.images) {
    const imageResult = await uploadMaterial(token, image, "image");
    if (!imageResult?.url) {
      throw new Error(`Image upload failed: ${JSON.stringify(imageResult)}`);
    }
    imageUrls.push(imageResult.url);
  }

  let content = loadContent(args.contentFile);
  content = replaceImagePlaceholders(content, imageUrls);

  const draftResult = await createDraft(token, {
    title: args.title,
    author: args.author,
    digest: args.digest,
    content,
    content_source_url: "",
    thumb_media_id: thumbResult.media_id,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  });

  if (!draftResult?.media_id) {
    throw new Error(`Draft creation failed: ${JSON.stringify(draftResult)}`);
  }

  if (args.outputJson) {
    console.log(
      JSON.stringify(
        {
          mediaId: draftResult.media_id,
          thumbMediaId: thumbResult.media_id,
          imageUrls,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("========================================");
  console.log("文章已成功添加到草稿箱！");
  console.log(`标题: ${args.title}`);
  console.log(`草稿 media_id: ${draftResult.media_id}`);
  console.log("========================================");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
