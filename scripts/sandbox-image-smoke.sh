#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${1:-openbot-sandbox:bookworm-slim}"

if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "error: image not found: ${IMAGE_NAME}" >&2
  exit 1
fi

docker run --rm --entrypoint bash "${IMAGE_NAME}" -lc '
set -euo pipefail
uid="$(id -u)"
gid="$(id -g)"
if [[ "${uid}" != "1000" || "${gid}" != "1000" ]]; then
  echo "error: runtime uid:gid is ${uid}:${gid}, expected 1000:1000" >&2
  echo "hint: never FROM node:* + naive useradd sandbox; use Dockerfile.sandbox" >&2
  exit 1
fi
node_major="$(node -p "process.versions.node.split(\".\")[0]")"
if [[ "${node_major}" != "20" ]]; then
  echo "error: node major is ${node_major}, expected 20 ($(node -v))" >&2
  exit 1
fi
command -v npm >/dev/null
command -v pdftotext >/dev/null
command -v pdfinfo >/dev/null
command -v pdftoppm >/dev/null
chrome_bin=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    chrome_bin="$(command -v "${candidate}")"
    break
  fi
done
if [[ -z "${chrome_bin}" || ! -x "${chrome_bin}" ]]; then
  echo "error: no executable google-chrome or chromium on PATH" >&2
  exit 1
fi
browser_version="$("${chrome_bin}" --version 2>&1)"
if ! fc-list | grep -q "Noto Sans CJK SC"; then
  echo "error: Noto Sans CJK SC is not registered with fontconfig" >&2
  exit 1
fi
probe_dir="$(mktemp -d)"
probe_html="${probe_dir}/probe.html"
probe_pdf="${probe_dir}/probe.pdf"
probe_txt="${probe_dir}/probe.txt"
chrome_user_dir="${probe_dir}/chrome"
mkdir -p "${chrome_user_dir}"
cat > "${probe_html}" <<EOF
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>sandbox pdf probe</title>
<style>
  body { font-family: "Noto Sans CJK SC", sans-serif; font-size: 28px; }
</style>
</head>
<body>
<p>中文 PDF 探测</p>
</body>
</html>
EOF
# --timeout caps a stalled subresource. dbus socket errors are non-fatal here.
if ! "${chrome_bin}" \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --timeout=15000 \
  --user-data-dir="${chrome_user_dir}" \
  --print-to-pdf="${probe_pdf}" \
  "${probe_html}" >/dev/null; then
  echo "error: system chromium failed to print a Chinese PDF (${chrome_bin})" >&2
  exit 1
fi
if [[ ! -s "${probe_pdf}" ]]; then
  echo "error: chromium did not write a PDF at ${probe_pdf}" >&2
  exit 1
fi
if ! pdftotext -layout "${probe_pdf}" "${probe_txt}"; then
  echo "error: pdftotext failed to extract text from ${probe_pdf}" >&2
  exit 1
fi
if ! grep -q "中文 PDF 探测" "${probe_txt}"; then
  echo "error: pdftotext did not extract Chinese probe text「中文 PDF 探测」" >&2
  echo "---- extracted ----" >&2
  cat "${probe_txt}" >&2 || true
  echo "---- end ----" >&2
  exit 1
fi
echo "pdftotext extracted: 中文 PDF 探测"
echo "sandbox smoke ok: uid:gid ${uid}:${gid} node $(node -v) npm $(npm -v) browser ${chrome_bin} (${browser_version}) pdftotext $(command -v pdftotext)"
'
