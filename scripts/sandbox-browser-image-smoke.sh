#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${1:-openbot-sandbox-browser:trixie}"

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
  exit 1
fi
node_ver="$(node -v)"
node_full="$(node -p "process.versions.node")"
node_major="$(node -p "process.versions.node.split(\".\")[0]")"
echo "node version string: ${node_ver} (process.versions.node=${node_full})"
# Node 20 is the compatibility TARGET for this round — not assumed from trixie alone.
if [[ "${node_major}" != "20" ]]; then
  echo "error: node major is ${node_major}, expected TARGET 20 (${node_ver})" >&2
  exit 1
fi
command -v npm >/dev/null
command -v pdftotext >/dev/null
command -v pdfinfo >/dev/null
command -v pdftoppm >/dev/null
if [[ ! -x /usr/local/bin/openbot-sandbox-browser ]]; then
  echo "error: missing /usr/local/bin/openbot-sandbox-browser" >&2
  exit 1
fi
if [[ ! -x /usr/local/bin/openbot-sandbox-desktop ]]; then
  echo "error: missing /usr/local/bin/openbot-sandbox-desktop" >&2
  exit 1
fi
if [[ ! -f /usr/local/share/openbot/desktop/index.html ]]; then
  echo "error: missing cloud-PC start page" >&2
  exit 1
fi
chrome_bin=""
for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    chrome_bin="$(command -v "${candidate}")"
    break
  fi
done
if [[ -z "${chrome_bin}" || ! -x "${chrome_bin}" ]]; then
  echo "error: no executable chromium on PATH" >&2
  exit 1
fi
browser_version="$("${chrome_bin}" --version 2>&1)"
echo "chromium: ${chrome_bin} (${browser_version})"
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
<title>sandbox browser pdf probe</title>
<style>
  body { font-family: "Noto Sans CJK SC", sans-serif; font-size: 28px; }
</style>
</head>
<body>
<p>中文 PDF 探测</p>
</body>
</html>
EOF
if ! "${chrome_bin}" \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --timeout=15000 \
  --user-data-dir="${chrome_user_dir}" \
  --print-to-pdf="${probe_pdf}" \
  "${probe_html}" >/dev/null; then
  echo "error: chromium failed headless PDF probe (${chrome_bin})" >&2
  exit 1
fi
if [[ ! -s "${probe_pdf}" ]]; then
  echo "error: chromium did not write a PDF at ${probe_pdf}" >&2
  exit 1
fi
if ! pdftotext -layout "${probe_pdf}" "${probe_txt}"; then
  echo "error: pdftotext failed" >&2
  exit 1
fi
if ! grep -q "中文 PDF 探测" "${probe_txt}"; then
  echo "error: pdftotext did not extract Chinese probe text" >&2
  cat "${probe_txt}" >&2 || true
  exit 1
fi
echo "pdftotext extracted: 中文 PDF 探测"
echo "sandbox-browser smoke ok: uid:gid ${uid}:${gid} node ${node_ver} npm $(npm -v) browser ${chrome_bin} (${browser_version}) pdftotext $(command -v pdftotext)"
'
