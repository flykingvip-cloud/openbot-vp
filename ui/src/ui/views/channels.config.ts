import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { ConfigUiHints } from "../types.ts";
import { formatChannelExtraValue, resolveChannelConfigValue } from "./channel-config-extras.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { analyzeConfigSchema, renderNode, schemaType, type JsonSchema } from "./config-form.ts";

type ChannelConfigFormProps = {
  channelId: string;
  configValue: Record<string, unknown> | null;
  schema: unknown;
  uiHints: ConfigUiHints;
  disabled: boolean;
  onPatch: (path: Array<string | number>, value: unknown) => void;
};

function resolveSchemaNode(
  schema: JsonSchema | null,
  path: Array<string | number>,
): JsonSchema | null {
  let current = schema;
  for (const key of path) {
    if (!current) {
      return null;
    }
    const type = schemaType(current);
    if (type === "object") {
      const properties = current.properties ?? {};
      if (typeof key === "string" && properties[key]) {
        current = properties[key];
        continue;
      }
      const additional = current.additionalProperties;
      if (typeof key === "string" && additional && typeof additional === "object") {
        current = additional;
        continue;
      }
      return null;
    }
    if (type === "array") {
      if (typeof key !== "number") {
        return null;
      }
      const items = Array.isArray(current.items) ? current.items[0] : current.items;
      current = items ?? null;
      continue;
    }
    return null;
  }
  return current;
}

function resolveChannelValue(
  config: Record<string, unknown>,
  channelId: string,
): Record<string, unknown> {
  return resolveChannelConfigValue(config, channelId) ?? {};
}

const EXTRA_CHANNEL_FIELDS = ["groupPolicy", "streamMode", "dmPolicy"] as const;

function localizeExtraFieldLabel(field: (typeof EXTRA_CHANNEL_FIELDS)[number]) {
  switch (field) {
    case "groupPolicy":
      return t("channelsPage.fields.groupPolicy");
    case "streamMode":
      return t("channelsPage.fields.streamMode");
    case "dmPolicy":
      return t("channelsPage.fields.dmPolicy");
    default:
      return field;
  }
}

function localizeChannelUiHints(channelId: string, uiHints: ConfigUiHints): ConfigUiHints {
  if (channelId !== "wecom") {
    return uiHints;
  }

  const overrides: ConfigUiHints = {
    "channels.wecom.enabled": {
      label: t("channelsPage.wecom.fields.enabled.label"),
    },
    "channels.wecom.name": {
      label: t("channelsPage.wecom.fields.name.label"),
      help: t("channelsPage.wecom.fields.name.help"),
    },
    "channels.wecom.corpId": {
      label: t("channelsPage.wecom.fields.corpId.label"),
      help: t("channelsPage.wecom.fields.corpId.help"),
    },
    "channels.wecom.agentId": {
      label: t("channelsPage.wecom.fields.agentId.label"),
      help: t("channelsPage.wecom.fields.agentId.help"),
    },
    "channels.wecom.secret": {
      label: t("channelsPage.wecom.fields.secret.label"),
      help: t("channelsPage.wecom.fields.secret.help"),
    },
    "channels.wecom.token": {
      label: t("channelsPage.wecom.fields.token.label"),
      help: t("channelsPage.wecom.fields.token.help"),
    },
    "channels.wecom.encodingAesKey": {
      label: t("channelsPage.wecom.fields.encodingAesKey.label"),
      help: t("channelsPage.wecom.fields.encodingAesKey.help"),
    },
    "channels.wecom.webhookPath": {
      label: t("channelsPage.wecom.fields.webhookPath.label"),
      help: t("channelsPage.wecom.fields.webhookPath.help"),
    },
    "channels.wecom.webhookUrl": {
      label: t("channelsPage.wecom.fields.webhookUrl.label"),
      help: t("channelsPage.wecom.fields.webhookUrl.help"),
    },
    "channels.wecom.defaultTo": {
      label: t("channelsPage.wecom.fields.defaultTo.label"),
      help: t("channelsPage.wecom.fields.defaultTo.help"),
    },
    "channels.wecom.defaultAccount": {
      label: t("channelsPage.wecom.fields.defaultAccount.label"),
      help: t("channelsPage.wecom.fields.defaultAccount.help"),
    },
    "channels.wecom.accounts": {
      label: t("channelsPage.wecom.fields.accounts.label"),
      help: t("channelsPage.wecom.fields.accounts.help"),
    },
    "channels.wecom.dm.policy": {
      label: t("channelsPage.wecom.fields.dmPolicy.label"),
      help: t("channelsPage.wecom.fields.dmPolicy.help"),
    },
    "channels.wecom.dm.allowFrom": {
      label: t("channelsPage.wecom.fields.dmAllowFrom.label"),
      help: t("channelsPage.wecom.fields.dmAllowFrom.help"),
    },
    "channels.wecom.textChunkLimit": {
      label: t("channelsPage.wecom.fields.textChunkLimit.label"),
      help: t("channelsPage.wecom.fields.textChunkLimit.help"),
    },
    "channels.wecom.publishedStatus": {
      label: t("channelsPage.wecom.fields.publishedStatus.label"),
      help: t("channelsPage.wecom.fields.publishedStatus.help"),
    },
    "channels.wecom.serverIpWhitelist": {
      label: t("channelsPage.wecom.fields.serverIpWhitelist.label"),
      help: t("channelsPage.wecom.fields.serverIpWhitelist.help"),
    },
    "channels.wecom.ipWhitelist": {
      label: t("channelsPage.wecom.fields.ipWhitelist.label"),
      help: t("channelsPage.wecom.fields.ipWhitelist.help"),
    },
    "channels.wecom.visibilityRange": {
      label: t("channelsPage.wecom.fields.visibilityRange.label"),
      help: t("channelsPage.wecom.fields.visibilityRange.help"),
    },
    "channels.wecom.visibleRange": {
      label: t("channelsPage.wecom.fields.visibleRange.label"),
      help: t("channelsPage.wecom.fields.visibleRange.help"),
    },
    "channels.wecom.callbackUrl": {
      label: t("channelsPage.wecom.fields.callbackUrl.label"),
      help: t("channelsPage.wecom.fields.callbackUrl.help"),
    },
    "channels.wecom.corpSecret": {
      label: t("channelsPage.wecom.fields.corpSecret.label"),
      help: t("channelsPage.wecom.fields.corpSecret.help"),
    },
    "channels.wecom.accounts.*.enabled": {
      label: t("channelsPage.wecom.fields.accountEnabled.label"),
    },
    "channels.wecom.accounts.*.name": {
      label: t("channelsPage.wecom.fields.name.label"),
      help: t("channelsPage.wecom.fields.accountName.help"),
    },
    "channels.wecom.accounts.*.corpId": {
      label: t("channelsPage.wecom.fields.corpId.label"),
      help: t("channelsPage.wecom.fields.corpId.help"),
    },
    "channels.wecom.accounts.*.agentId": {
      label: t("channelsPage.wecom.fields.agentId.label"),
      help: t("channelsPage.wecom.fields.agentId.help"),
    },
    "channels.wecom.accounts.*.secret": {
      label: t("channelsPage.wecom.fields.secret.label"),
      help: t("channelsPage.wecom.fields.secret.help"),
    },
    "channels.wecom.accounts.*.corpSecret": {
      label: t("channelsPage.wecom.fields.corpSecret.label"),
      help: t("channelsPage.wecom.fields.corpSecret.help"),
    },
    "channels.wecom.accounts.*.token": {
      label: t("channelsPage.wecom.fields.token.label"),
      help: t("channelsPage.wecom.fields.token.help"),
    },
    "channels.wecom.accounts.*.encodingAesKey": {
      label: t("channelsPage.wecom.fields.encodingAesKey.label"),
      help: t("channelsPage.wecom.fields.encodingAesKey.help"),
    },
    "channels.wecom.accounts.*.webhookPath": {
      label: t("channelsPage.wecom.fields.webhookPath.label"),
      help: t("channelsPage.wecom.fields.webhookPath.help"),
    },
    "channels.wecom.accounts.*.webhookUrl": {
      label: t("channelsPage.wecom.fields.webhookUrl.label"),
      help: t("channelsPage.wecom.fields.webhookUrl.help"),
    },
    "channels.wecom.accounts.*.callbackUrl": {
      label: t("channelsPage.wecom.fields.callbackUrl.label"),
      help: t("channelsPage.wecom.fields.callbackUrl.help"),
    },
    "channels.wecom.accounts.*.defaultTo": {
      label: t("channelsPage.wecom.fields.defaultTo.label"),
      help: t("channelsPage.wecom.fields.defaultTo.help"),
    },
    "channels.wecom.accounts.*.dm.policy": {
      label: t("channelsPage.wecom.fields.dmPolicy.label"),
      help: t("channelsPage.wecom.fields.dmPolicy.help"),
    },
    "channels.wecom.accounts.*.dm.allowFrom": {
      label: t("channelsPage.wecom.fields.dmAllowFrom.label"),
      help: t("channelsPage.wecom.fields.dmAllowFrom.help"),
    },
    "channels.wecom.accounts.*.textChunkLimit": {
      label: t("channelsPage.wecom.fields.textChunkLimit.label"),
      help: t("channelsPage.wecom.fields.textChunkLimit.help"),
    },
    "channels.wecom.accounts.*.publishedStatus": {
      label: t("channelsPage.wecom.fields.publishedStatus.label"),
      help: t("channelsPage.wecom.fields.publishedStatus.help"),
    },
    "channels.wecom.accounts.*.serverIpWhitelist": {
      label: t("channelsPage.wecom.fields.serverIpWhitelist.label"),
      help: t("channelsPage.wecom.fields.serverIpWhitelist.help"),
    },
    "channels.wecom.accounts.*.ipWhitelist": {
      label: t("channelsPage.wecom.fields.ipWhitelist.label"),
      help: t("channelsPage.wecom.fields.ipWhitelist.help"),
    },
    "channels.wecom.accounts.*.visibilityRange": {
      label: t("channelsPage.wecom.fields.visibilityRange.label"),
      help: t("channelsPage.wecom.fields.visibilityRange.help"),
    },
    "channels.wecom.accounts.*.visibleRange": {
      label: t("channelsPage.wecom.fields.visibleRange.label"),
      help: t("channelsPage.wecom.fields.visibleRange.help"),
    },
  };

  return Object.fromEntries(
    Object.entries({ ...uiHints, ...overrides }).map(([key, value]) => [
      key,
      { ...uiHints[key], ...value },
    ]),
  );
}

function renderExtraChannelFields(value: Record<string, unknown>) {
  const entries = EXTRA_CHANNEL_FIELDS.flatMap((field) => {
    if (!(field in value)) {
      return [];
    }
    return [[field, value[field]]] as Array<[string, unknown]>;
  });
  if (entries.length === 0) {
    return null;
  }
  return html`
    <div class="status-list" style="margin-top: 12px;">
      ${entries.map(
        ([field, raw]) => html`
          <div>
            <span class="label">${localizeExtraFieldLabel(field as (typeof EXTRA_CHANNEL_FIELDS)[number])}</span>
            <span>${formatChannelExtraValue(raw)}</span>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderChannelConfigForm(props: ChannelConfigFormProps) {
  const analysis = analyzeConfigSchema(props.schema);
  const normalized = analysis.schema;
  if (!normalized) {
    return html`
      <div class="callout danger">${t("channelsPage.schemaUnavailable")}</div>
    `;
  }
  const node = resolveSchemaNode(normalized, ["channels", props.channelId]);
  if (!node) {
    return html`
      <div class="callout danger">${t("channelsPage.channelSchemaUnavailable")}</div>
    `;
  }
  const configValue = props.configValue ?? {};
  const value = resolveChannelValue(configValue, props.channelId);
  return html`
    <div class="config-form">
      ${renderNode({
        schema: node,
        value,
        path: ["channels", props.channelId],
        hints: localizeChannelUiHints(props.channelId, props.uiHints),
        unsupported: new Set(analysis.unsupportedPaths),
        disabled: props.disabled,
        showLabel: false,
        onPatch: props.onPatch,
      })}
    </div>
    ${renderExtraChannelFields(value)}
  `;
}

export function renderChannelConfigSection(params: { channelId: string; props: ChannelsProps }) {
  const { channelId, props } = params;
  const disabled = props.configSaving || props.configSchemaLoading;
  return html`
    <div style="margin-top: 16px;">
      ${
        props.configSchemaLoading
          ? html`
              <div class="muted">${t("channelsPage.loadingConfigSchema")}</div>
            `
          : renderChannelConfigForm({
              channelId,
              configValue: props.configForm,
              schema: props.configSchema,
              uiHints: props.configUiHints,
              disabled,
              onPatch: props.onConfigPatch,
            })
      }
      <div class="row" style="margin-top: 12px;">
        <button
          class="btn primary"
          ?disabled=${disabled || !props.configFormDirty}
          @click=${() => props.onConfigSave()}
        >
          ${props.configSaving ? t("channelsPage.saving") : t("channelsPage.save")}
        </button>
        <button
          class="btn"
          ?disabled=${disabled}
          @click=${() => props.onConfigReload()}
        >
          ${t("channelsPage.reload")}
        </button>
      </div>
    </div>
  `;
}
