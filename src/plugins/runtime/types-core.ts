import type { LogLevel } from "../../logging/levels.js";

type PluginMemoryToolFactory = (options: {
  config?: import("../../config/types.openbot.js").OpenBotConfig;
  agentSessionKey?: string;
  governance?: import("../../memory/memory-search-governance.js").MemorySearchGovernance;
  /** Authenticated human for members.json continuity authz (produced by memory-core). */
  authenticatedUserId?: string | null;
  /** Trusted security mode when full accessContext is not built (builtin/plugin path). */
  securityProfile?: "personal_local" | "managed_enterprise";
  accessContext?: import("../../memory/memory-index-access-context.js").MemoryIndexAccessContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: import("../../gateway/server-methods/types.js").GatewayClient["sessionDomain"];
}) => import("../../agents/tools/common.js").AnyAgentTool | null;

type RuntimeWriteConfigOptions = {
  envSnapshotForRestore?: Record<string, string | undefined>;
  expectedConfigPath?: string;
  unsetPaths?: string[][];
};

export type RuntimeLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export type PluginRuntimeCore = {
  version: string;
  config: {
    loadConfig: () => import("../../config/types.openbot.js").OpenBotConfig;
    writeConfigFile: (
      cfg: import("../../config/types.openbot.js").OpenBotConfig,
      options?: RuntimeWriteConfigOptions,
    ) => Promise<void>;
  };
  system: {
    enqueueSystemEvent: typeof import("../../infra/system-events.js").enqueueSystemEvent;
    requestHeartbeatNow: typeof import("../../infra/heartbeat-wake.js").requestHeartbeatNow;
    runCommandWithTimeout: typeof import("../../process/exec.js").runCommandWithTimeout;
    formatNativeDependencyHint: typeof import("./native-deps.js").formatNativeDependencyHint;
  };
  media: {
    loadWebMedia: typeof import("../../web/media.js").loadWebMedia;
    detectMime: typeof import("../../media/mime.js").detectMime;
    mediaKindFromMime: typeof import("../../media/constants.js").mediaKindFromMime;
    isVoiceCompatibleAudio: typeof import("../../media/audio.js").isVoiceCompatibleAudio;
    getImageMetadata: typeof import("../../media/image-ops.js").getImageMetadata;
    resizeToJpeg: typeof import("../../media/image-ops.js").resizeToJpeg;
  };
  tts: {
    textToSpeechTelephony: typeof import("../../tts/tts.js").textToSpeechTelephony;
  };
  stt: {
    transcribeAudioFile: typeof import("../../media-understanding/transcribe-audio.js").transcribeAudioFile;
  };
  tools: {
    // Keep plugin-sdk declarations decoupled from the full memory CLI/runtime graph.
    createMemoryGetTool: PluginMemoryToolFactory;
    createMemorySearchTool: PluginMemoryToolFactory;
    registerMemoryCli: (program: import("commander").Command) => void;
  };
  events: {
    onAgentEvent: typeof import("../../infra/agent-events.js").onAgentEvent;
    onSessionTranscriptUpdate: typeof import("../../sessions/transcript-events.js").onSessionTranscriptUpdate;
  };
  logging: {
    shouldLogVerbose: typeof import("../../globals.js").shouldLogVerbose;
    getChildLogger: (
      bindings?: Record<string, unknown>,
      opts?: { level?: LogLevel },
    ) => RuntimeLogger;
  };
  state: {
    resolveStateDir: typeof import("../../config/paths.js").resolveStateDir;
  };
  modelAuth: {
    /** Resolve auth for a model. Only provider/model and optional cfg are used. */
    getApiKeyForModel: (params: {
      model: import("@earendil-works/pi-ai/compat").Model<
        import("@earendil-works/pi-ai/compat").Api
      >;
      cfg?: import("../../config/types.openbot.js").OpenBotConfig;
    }) => Promise<import("../../agents/model-auth.js").ResolvedProviderAuth>;
    /** Resolve auth for a provider by name. Only provider and optional cfg are used. */
    resolveApiKeyForProvider: (params: {
      provider: string;
      cfg?: import("../../config/types.openbot.js").OpenBotConfig;
    }) => Promise<import("../../agents/model-auth.js").ResolvedProviderAuth>;
  };
};
