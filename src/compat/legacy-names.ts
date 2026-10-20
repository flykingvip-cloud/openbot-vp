// Project naming compatibility layer.
//
// This module is the single source of truth for the project's current and
// legacy names. Phase-1 of the openclaw → openbot rebrand flips the primary
// identifiers here and records the legacy ones so that:
//
//   - plugin manifests named `openclaw.plugin.json` still load
//   - `package.json` metadata under the legacy `"openclaw"` key still resolves
//   - YAML/Markdown front-matter `metadata.openclaw` blocks still parse
//
// Downstream code should read these constants rather than hard-coding either
// name. Once the ecosystem has migrated (see docs rebrand notes), the legacy
// entries can be removed in a follow-up.

export const PROJECT_NAME = "openbot" as const;

export const LEGACY_PROJECT_NAMES = ["openclaw"] as const;

export const MANIFEST_KEY = PROJECT_NAME;

export const LEGACY_MANIFEST_KEYS = LEGACY_PROJECT_NAMES;

export const LEGACY_PLUGIN_MANIFEST_FILENAMES = ["openclaw.plugin.json"] as const;

export const LEGACY_CANVAS_HANDLER_NAMES = [] as const;

export const LEGACY_CANVAS_GLOBAL_NAMES = ["OpenClaw"] as const;

export const LEGACY_EXTENSION_RELAY_BROWSERS = ["OpenClaw/extension-relay"] as const;

export const LEGACY_GATEWAY_WINDOWS_TASK_NAMES = ["OpenClaw Gateway"] as const;

export const LEGACY_HOOK_TOKEN_HEADER_DISPLAY_NAMES = ["X-OpenClaw-Token"] as const;

export const LEGACY_INTERNAL_EVENT_CONTEXT_PREFIXES = [
  "OpenClaw runtime context (internal):",
] as const;

export const LEGACY_PRODUCT_DISPLAY_NAMES = ["OpenClaw"] as const;

export const MACOS_APP_SOURCES_DIR = "apps/macos/Sources/OpenBot" as const;

export const LEGACY_MACOS_APP_SOURCES_DIRS = ["apps/macos/Sources/OpenClaw"] as const;
