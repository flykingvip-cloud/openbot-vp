/**
 * Sync vault (E2EE) import form — replaces cloud-drive as the cross-device entry.
 * Password field is memory-only; never persisted to localStorage.
 */
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";

function shortId(value: string | null | undefined): string {
  const id = (value ?? "").trim();
  if (id.length <= 12) {
    return id || "—";
  }
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function renderVaultSyncImportForm(
  surface: WorkbenchKnowledgeSurface,
  options?: { embedInFolderSync?: boolean },
) {
  const embed = Boolean(options?.embedInFolderSync);
  const spaceTitle =
    surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId)?.title ??
    t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.defaultTitle");
  const rootPath = surface.vaultSyncRootPath ?? "";
  const password = surface.vaultSyncPassword ?? "";
  const vaultId = surface.vaultSyncVaultId ?? null;
  const deviceId = surface.vaultSyncDeviceId ?? null;
  const hasSession = Boolean(vaultId && deviceId);
  const revisionId = surface.vaultSyncRevisionId ?? "";
  const includeImages = surface.vaultSyncIncludeImages ?? true;
  const excludeGlobsText = surface.vaultSyncExcludeGlobsText ?? "";
  const devices = surface.vaultSyncDevices ?? [];
  const teamEnabled = surface.vaultSyncTeamEnabled ?? false;
  const members = surface.vaultSyncMembers ?? [];
  const invites = surface.vaultSyncInvites ?? [];
  const inviteeAccountId = surface.vaultSyncInviteeAccountId ?? "";
  const acceptInviteId = surface.vaultSyncAcceptInviteId ?? "";
  const inviteSecret = surface.vaultSyncInviteSecret ?? "";
  const lastInviteSecret = surface.vaultSyncLastCreatedInviteSecret ?? null;
  const busy = surface.personalActionBusy;
  const canSubmit = Boolean(password.trim()) && !busy && Boolean(surface.onCreateVaultSync);
  const canSyncNow =
    hasSession && Boolean(password.trim()) && !busy && Boolean(surface.onSyncVaultNow);
  const canRestore =
    hasSession &&
    Boolean(password.trim()) &&
    Boolean(revisionId.trim()) &&
    !busy &&
    Boolean(surface.onRestoreVaultRevision);
  const canEnableTeam =
    hasSession &&
    Boolean(password.trim()) &&
    !teamEnabled &&
    !busy &&
    Boolean(surface.onEnableVaultSyncTeam);
  const canBumpEpoch =
    hasSession &&
    teamEnabled &&
    Boolean(password.trim()) &&
    !busy &&
    Boolean(surface.onBumpVaultSyncEncryptionEpoch);
  const canCreateInvite =
    hasSession &&
    teamEnabled &&
    Boolean(password.trim()) &&
    !busy &&
    Boolean(surface.onCreateVaultSyncInvite);
  const canAcceptInvite =
    hasSession &&
    Boolean(acceptInviteId.trim()) &&
    Boolean(inviteSecret.trim()) &&
    !busy &&
    Boolean(surface.onAcceptVaultSyncInvite);

  return html`
    <div
      class="ku-space-import__vault-sync ku-space-import__channel"
      data-testid="ku-space-import-form-vaultSync"
    >
      ${
        embed
          ? nothing
          : html`
              <p class="ku-space-import__target">
                ${t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.targetLabel", {
                  spaceTitle,
                })}
              </p>
            `
      }
      <p class="ku-space-import__hint">
        ${t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.e2eeHint")}
      </p>

      <label class="knowledge-universe__field ku-space-import__field">
        <span
          >${t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.rootLabel")}</span
        >
        <div class="ku-space-import__field-row">
          <input
            type="text"
            class="ku-space-import__input"
            data-testid="ku-space-import-vault-root"
            .value=${rootPath}
            ?disabled=${busy}
            readonly
            placeholder=${t(
              "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.rootPlaceholder",
            )}
          />
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="ku-space-import-vault-pick-folder"
            ?disabled=${busy}
            @click=${() => void surface.onPickVaultSyncFolder?.()}
          >
            ${t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.pickFolderAction")}
          </button>
        </div>
      </label>

      <label class="knowledge-universe__field ku-space-import__field">
        <span
          >${t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.passwordLabel",
          )}</span
        >
        <input
          type="password"
          class="ku-space-import__input"
          data-testid="ku-space-import-vault-password"
          autocomplete="new-password"
          .value=${password}
          ?disabled=${busy}
          placeholder=${t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.passwordPlaceholder",
          )}
          @input=${(event: Event) => {
            surface.onVaultSyncPasswordChange?.((event.target as HTMLInputElement).value);
          }}
        />
      </label>

      ${
        surface.vaultSyncStatus
          ? html`<p class="ku-space-import__status" data-testid="ku-space-import-vault-status">
              ${t(
                `frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.status.${surface.vaultSyncStatus}`,
              )}
            </p>`
          : null
      }

      <div class="ku-space-import__actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="ku-space-import-vault-submit"
          ?disabled=${!canSubmit}
          @click=${() => void surface.onCreateVaultSync?.()}
        >
          ${
            busy
              ? t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.submitBusy")
              : t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.submitAction")
          }
        </button>
      </div>

      ${
        hasSession
          ? html`
              <section
                class="ku-space-import__vault-manage"
                data-testid="ku-space-import-vault-manage"
              >
                <h3 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.title",
                  )}
                </h3>
                <p class="ku-space-import__hint">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.sessionSummary",
                    {
                      vaultId: shortId(vaultId),
                      deviceId: shortId(deviceId),
                    },
                  )}
                </p>

                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-sync-now"
                    ?disabled=${!canSyncNow}
                    @click=${() => void surface.onSyncVaultNow?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.syncNow",
                    )}
                  </button>
                </div>

                <h4 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.restoreTitle",
                  )}
                </h4>
                <label class="knowledge-universe__field ku-space-import__field">
                  <span
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.revisionLabel",
                    )}</span
                  >
                  <input
                    type="text"
                    class="ku-space-import__input"
                    data-testid="ku-space-import-vault-revision"
                    .value=${revisionId}
                    ?disabled=${busy}
                    placeholder=${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.revisionPlaceholder",
                    )}
                    @input=${(event: Event) => {
                      surface.onVaultSyncRevisionIdChange?.(
                        (event.target as HTMLInputElement).value,
                      );
                    }}
                  />
                </label>
                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-restore"
                    ?disabled=${!canRestore}
                    @click=${() => void surface.onRestoreVaultRevision?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.restoreAction",
                    )}
                  </button>
                </div>

                <h4 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.selectiveTitle",
                  )}
                </h4>
                <label class="knowledge-universe__field ku-space-import__field ku-space-import__checkbox">
                  <input
                    type="checkbox"
                    data-testid="ku-space-import-vault-include-images"
                    .checked=${includeImages}
                    ?disabled=${busy}
                    @change=${(event: Event) => {
                      surface.onVaultSyncIncludeImagesChange?.(
                        (event.target as HTMLInputElement).checked,
                      );
                    }}
                  />
                  <span
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.includeImages",
                    )}</span
                  >
                </label>
                <label class="knowledge-universe__field ku-space-import__field">
                  <span
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.excludeGlobsLabel",
                    )}</span
                  >
                  <textarea
                    class="ku-space-import__input"
                    rows="3"
                    data-testid="ku-space-import-vault-exclude-globs"
                    .value=${excludeGlobsText}
                    ?disabled=${busy}
                    placeholder=${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.excludeGlobsPlaceholder",
                    )}
                    @input=${(event: Event) => {
                      surface.onVaultSyncExcludeGlobsTextChange?.(
                        (event.target as HTMLTextAreaElement).value,
                      );
                    }}
                  ></textarea>
                </label>
                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-selective-load"
                    ?disabled=${busy || !surface.onLoadVaultSyncSelective}
                    @click=${() => void surface.onLoadVaultSyncSelective?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.selectiveLoad",
                    )}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-selective-save"
                    ?disabled=${busy || !surface.onSaveVaultSyncSelective}
                    @click=${() => void surface.onSaveVaultSyncSelective?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.selectiveSave",
                    )}
                  </button>
                </div>

                <h4 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.devicesTitle",
                  )}
                </h4>
                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-devices-load"
                    ?disabled=${busy || !surface.onLoadVaultSyncDevices}
                    @click=${() => void surface.onLoadVaultSyncDevices?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.devicesLoad",
                    )}
                  </button>
                </div>
                ${
                  devices.length > 0
                    ? html`<ul
                        class="ku-space-import__vault-devices"
                        data-testid="ku-space-import-vault-devices"
                      >
                        ${devices.map((device) => {
                          const isCurrent = device.deviceId === deviceId;
                          const revoked = device.status === "revoked";
                          return html`
                            <li class="ku-space-import__vault-device">
                              <span
                                >${shortId(device.deviceId)}${
                                  device.platform ? ` · ${device.platform}` : ""
                                }${device.status ? ` · ${device.status}` : ""}${
                                  isCurrent
                                    ? ` · ${t(
                                        "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.currentDevice",
                                      )}`
                                    : ""
                                }</span
                              >
                              <button
                                type="button"
                                class="btn btn--danger"
                                data-testid="ku-space-import-vault-device-revoke"
                                ?disabled=${
                                  busy || isCurrent || revoked || !surface.onRevokeVaultSyncDevice
                                }
                                @click=${() =>
                                  void surface.onRevokeVaultSyncDevice?.(device.deviceId)}
                              >
                                ${t(
                                  "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.revokeDevice",
                                )}
                              </button>
                            </li>
                          `;
                        })}
                      </ul>`
                    : html`<p class="ku-space-import__hint">
                        ${t(
                          "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.devicesEmpty",
                        )}
                      </p>`
                }

                <h4 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.teamTitle",
                  )}
                </h4>
                <p class="ku-space-import__hint">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.teamHint",
                  )}
                </p>
                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-team-refresh"
                    ?disabled=${busy || !surface.onRefreshVaultSyncTeam}
                    @click=${() => void surface.onRefreshVaultSyncTeam?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.teamRefresh",
                    )}
                  </button>
                  ${
                    !teamEnabled
                      ? html`<button
                          type="button"
                          class="btn btn--primary"
                          data-testid="ku-space-import-vault-team-enable"
                          ?disabled=${!canEnableTeam}
                          @click=${() => void surface.onEnableVaultSyncTeam?.()}
                        >
                          ${t(
                            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.teamEnable",
                          )}
                        </button>`
                      : null
                  }
                  ${
                    teamEnabled
                      ? html`<button
                          type="button"
                          class="btn"
                          data-testid="ku-space-import-vault-team-bump-epoch"
                          ?disabled=${!canBumpEpoch}
                          @click=${() => void surface.onBumpVaultSyncEncryptionEpoch?.()}
                        >
                          ${t(
                            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.teamBumpEpoch",
                          )}
                        </button>`
                      : null
                  }
                </div>
                ${
                  teamEnabled
                    ? html`
                        <label class="knowledge-universe__field ku-space-import__field">
                          <span
                            >${t(
                              "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.inviteeLabel",
                            )}</span
                          >
                          <input
                            type="text"
                            class="ku-space-import__input"
                            data-testid="ku-space-import-vault-invitee"
                            .value=${inviteeAccountId}
                            ?disabled=${busy}
                            placeholder=${t(
                              "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.inviteePlaceholder",
                            )}
                            @input=${(event: Event) => {
                              surface.onVaultSyncInviteeAccountIdChange?.(
                                (event.target as HTMLInputElement).value,
                              );
                            }}
                          />
                        </label>
                        <div class="ku-space-import__actions">
                          <button
                            type="button"
                            class="btn"
                            data-testid="ku-space-import-vault-invite-create"
                            ?disabled=${!canCreateInvite}
                            @click=${() => void surface.onCreateVaultSyncInvite?.()}
                          >
                            ${t(
                              "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.inviteCreate",
                            )}
                          </button>
                        </div>
                        ${
                          lastInviteSecret
                            ? html`<p
                                class="ku-space-import__status"
                                data-testid="ku-space-import-vault-invite-secret"
                              >
                                ${t(
                                  "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.inviteSecretOnce",
                                  { secret: lastInviteSecret },
                                )}
                              </p>`
                            : null
                        }
                        ${
                          members.length > 0
                            ? html`<ul
                                class="ku-space-import__vault-devices"
                                data-testid="ku-space-import-vault-members"
                              >
                                ${members.map((member) => {
                                  const revoked = member.status === "revoked";
                                  const isOwner = member.role === "owner";
                                  return html`
                                    <li class="ku-space-import__vault-device">
                                      <span
                                        >${member.memberAccountId}${
                                          member.role ? ` · ${member.role}` : ""
                                        }${member.status ? ` · ${member.status}` : ""}</span
                                      >
                                      <button
                                        type="button"
                                        class="btn btn--danger"
                                        data-testid="ku-space-import-vault-member-revoke"
                                        ?disabled=${
                                          busy ||
                                          revoked ||
                                          isOwner ||
                                          !password.trim() ||
                                          !surface.onRevokeVaultSyncMember
                                        }
                                        @click=${() =>
                                          void surface.onRevokeVaultSyncMember?.(
                                            member.memberAccountId,
                                          )}
                                      >
                                        ${t(
                                          "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.revokeMember",
                                        )}
                                      </button>
                                    </li>
                                  `;
                                })}
                              </ul>`
                            : html`<p class="ku-space-import__hint">
                                ${t(
                                  "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.membersEmpty",
                                )}
                              </p>`
                        }
                        ${
                          invites.length > 0
                            ? html`<ul
                                class="ku-space-import__vault-devices"
                                data-testid="ku-space-import-vault-invites"
                              >
                                ${invites.map((invite) => {
                                  const revoked =
                                    invite.status === "revoked" || invite.status === "accepted";
                                  return html`
                                    <li class="ku-space-import__vault-device">
                                      <span
                                        >${shortId(invite.inviteId)}${
                                          invite.role ? ` · ${invite.role}` : ""
                                        }${invite.status ? ` · ${invite.status}` : ""}</span
                                      >
                                      <button
                                        type="button"
                                        class="btn btn--danger"
                                        data-testid="ku-space-import-vault-invite-revoke"
                                        ?disabled=${busy || revoked || !surface.onRevokeVaultSyncInvite}
                                        @click=${() =>
                                          void surface.onRevokeVaultSyncInvite?.(invite.inviteId)}
                                      >
                                        ${t(
                                          "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.revokeInvite",
                                        )}
                                      </button>
                                    </li>
                                  `;
                                })}
                              </ul>`
                            : null
                        }
                      `
                    : null
                }

                <h4 class="ku-space-import__section-title">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.acceptInviteTitle",
                  )}
                </h4>
                <label class="knowledge-universe__field ku-space-import__field">
                  <span
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.acceptInviteIdLabel",
                    )}</span
                  >
                  <input
                    type="text"
                    class="ku-space-import__input"
                    data-testid="ku-space-import-vault-accept-invite-id"
                    .value=${acceptInviteId}
                    ?disabled=${busy}
                    placeholder=${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.acceptInviteIdPlaceholder",
                    )}
                    @input=${(event: Event) => {
                      surface.onVaultSyncAcceptInviteIdChange?.(
                        (event.target as HTMLInputElement).value,
                      );
                    }}
                  />
                </label>
                <label class="knowledge-universe__field ku-space-import__field">
                  <span
                    >${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.acceptInviteSecretLabel",
                    )}</span
                  >
                  <input
                    type="password"
                    class="ku-space-import__input"
                    data-testid="ku-space-import-vault-accept-invite-secret"
                    autocomplete="off"
                    .value=${inviteSecret}
                    ?disabled=${busy}
                    @input=${(event: Event) => {
                      surface.onVaultSyncInviteSecretChange?.(
                        (event.target as HTMLInputElement).value,
                      );
                    }}
                  />
                </label>
                <div class="ku-space-import__actions">
                  <button
                    type="button"
                    class="btn"
                    data-testid="ku-space-import-vault-accept-invite"
                    ?disabled=${!canAcceptInvite}
                    @click=${() => void surface.onAcceptVaultSyncInvite?.()}
                  >
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.manage.acceptInviteAction",
                    )}
                  </button>
                </div>
              </section>
            `
          : null
      }
    </div>
  `;
}
