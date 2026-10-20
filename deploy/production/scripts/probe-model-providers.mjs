#!/usr/bin/env node
// probe-model-providers.mjs — ask every configured model provider to list its
// models, using the credentials the gateway actually uses.
//
// Why not just GET the base URL: a bare GET cannot see the failure class this
// exists for. On 2026-10-01 production Gemini calls failed with
//   400 FAILED_PRECONDITION "User location is not supported for the API use."
// while `GET https://generativelanguage.googleapis.com/v1beta` answered 404 —
// i.e. "reachable". Only an authenticated request against a real endpoint
// distinguishes "the network reaches it" from "it will serve this host".
//
// Designed to run inside the gateway container (node 22, global fetch), reading
// the same config file the gateway reads. API keys are never printed: every
// emitted field is scrubbed of each key it saw.
//
// Transport failures are retried (a single TLS blip once turned a healthy
// provider into a FAIL); refusals are not, because they are deterministic.
//
// Output: one TSV record per provider, so a shell caller can judge it:
//   <name>\t<api>\t<httpCode|000>\t<OK|REFUSED|UNREACHABLE|SKIP>\t<detail>
// Exit code is always 0; the caller decides what is fatal.

import { readFile } from "node:fs/promises";

const CONFIG_PATH = process.env.OPENBOT_PROBE_CONFIG ?? "/root/.openbot/openbot.json";
const TIMEOUT_MS = Number(process.env.OPENBOT_PROBE_TIMEOUT_MS ?? 20000);
const RETRIES = Number(process.env.OPENBOT_PROBE_RETRIES ?? 2);
const RETRY_DELAY_MS = Number(process.env.OPENBOT_PROBE_RETRY_DELAY_MS ?? 1500);

// Phrases that mean "the endpoint answered, and refused to serve us". These are
// the quiet failures: the gateway stays healthy and only user replies break.
const REFUSAL_PATTERNS = [
  "user location is not supported",
  "unsupported_country_region_territory",
  "failed_precondition",
  "permission_denied",
  "api key not valid",
  "invalid api key",
  "incorrect api key",
  "invalid_api_key",
  "unauthorized",
  "quota",
  "insufficient balance",
];

/** Collapse whitespace and cut to a single log-friendly line. */
function oneLine(text, max = 240) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Remove every provider secret we have seen from a string before printing it. */
function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join("<REDACTED>");
    }
  }
  return out;
}

/**
 * Build the model-listing request for a provider. Providers disagree on both the
 * path and where the credential goes, so this is per-API rather than generic.
 */
function buildModelListRequest(api, baseUrl, apiKey) {
  const base = baseUrl.replace(/\/+$/, "");
  if (api === "google-generative-ai") {
    // Gemini takes the key as a query parameter.
    return { url: `${base}/models?key=${encodeURIComponent(apiKey)}`, headers: {} };
  }
  if (api === "anthropic") {
    return {
      url: `${base}/models`,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    };
  }
  // openai-completions / openai-responses / anything OpenAI-compatible.
  return { url: `${base}/models`, headers: { authorization: `Bearer ${apiKey}` } };
}

async function probeOnce(name, api, url, headers, secrets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const body = scrub(oneLine(await res.text()), secrets);
    const haystack = body.toLowerCase();
    const matched = REFUSAL_PATTERNS.find((p) => haystack.includes(p));
    if (res.ok && !matched) {
      return { name, api, code: String(res.status), verdict: "OK", detail: "" };
    }
    return {
      name,
      api,
      code: String(res.status),
      verdict: "REFUSED",
      detail: matched ? `matched "${matched}": ${body}` : body,
    };
  } catch (err) {
    const reason =
      err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : oneLine(err?.message ?? err);
    return { name, api, code: "000", verdict: "UNREACHABLE", detail: scrub(reason, secrets) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(name, provider, secrets) {
  const api = provider.api ?? provider.type ?? "openai-completions";
  const baseUrl = provider.baseUrl ?? "";
  const apiKey = provider.apiKey ?? "";
  if (!baseUrl) {
    return { name, api, code: "000", verdict: "SKIP", detail: "no baseUrl configured" };
  }
  if (!apiKey) {
    return { name, api, code: "000", verdict: "SKIP", detail: "no apiKey configured" };
  }

  const { url, headers } = buildModelListRequest(api, baseUrl, apiKey);
  // Retry transport failures only. A gate that cries wolf on a one-off TLS blip
  // gets ignored, and an ignored gate is not a gate. REFUSED is deterministic
  // (geo-block, bad key, exhausted quota), so retrying it would hide the signal.
  let result = await probeOnce(name, api, url, headers, secrets);
  for (let attempt = 1; attempt <= RETRIES && result.verdict === "UNREACHABLE"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    result = await probeOnce(name, api, url, headers, secrets);
    if (result.verdict !== "UNREACHABLE") {
      result.detail = oneLine(`recovered on retry ${attempt}`);
    } else if (attempt === RETRIES) {
      result.detail = oneLine(`${result.detail} (after ${RETRIES + 1} attempts)`);
    }
  }
  return result;
}

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch (err) {
    process.stdout.write(
      `-\t-\t000\tSKIP\tcannot read ${CONFIG_PATH}: ${oneLine(err?.message ?? err)}\n`,
    );
    return;
  }
  const providers = config?.models?.providers ?? {};
  const names = Object.keys(providers).toSorted();
  if (names.length === 0) {
    process.stdout.write("-\t-\t000\tSKIP\tno models.providers configured\n");
    return;
  }
  // Collect every secret up front so one provider's body cannot leak another's key.
  const secrets = names.map((n) => providers[n]?.apiKey).filter(Boolean);
  const results = await Promise.all(names.map((n) => probe(n, providers[n] ?? {}, secrets)));
  for (const r of results) {
    process.stdout.write([r.name, r.api, r.code, r.verdict, oneLine(r.detail)].join("\t") + "\n");
  }
}

await main();
