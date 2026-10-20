//
//  EmployeeAccountManager.swift
//  Account lifecycle coordinator (tasks 1.3-ios / 1.4-ios / 1.6-ios).
//
//  Owns the set of employee accounts, the active-account pointer, and one
//  `EmployeeSessionContainer` per account. Implements the lifecycle table from
//  account-session-model.md (add/login, switch account, switch org, logout, remove)
//  with the guarantee that switching accounts never leaks the previous account's
//  cookies/in-memory state, and that logout/switch-org never disturbs node pairing.
//
//  Uses the Observation framework (`@Observable`) per repo SwiftUI guidance.
//

import Foundation
import Observation

@MainActor
@Observable
final class EmployeeAccountManager {
    /// Known accounts (index-ordered).
    private(set) var accounts: [EmployeeAccount] = []
    /// Currently active account, or nil when logged out of all accounts.
    private(set) var activeAccountId: String?

    /// Live container cache. Never shared across accounts.
    private var containers: [String: EmployeeSessionContainer] = [:]

    init() {
        self.reload()
    }

    private func reload() {
        self.accounts = EmployeeAccountStore.listAccounts()
        let stored = EmployeeAccountStore.activeAccountId()
        // Guard against a dangling active pointer.
        self.activeAccountId = self.accounts.contains(where: { $0.accountId == stored })
            ? stored
            : self.accounts.first?.accountId
        if self.activeAccountId != stored {
            EmployeeAccountStore.setActiveAccountId(self.activeAccountId)
        }
    }

    var activeAccount: EmployeeAccount? {
        guard let id = self.activeAccountId else { return nil }
        return self.accounts.first(where: { $0.accountId == id })
    }

    /// Container for the active account (created lazily), or nil when logged out.
    var activeContainer: EmployeeSessionContainer? {
        guard let account = self.activeAccount else { return nil }
        return self.container(for: account)
    }

    func container(for account: EmployeeAccount) -> EmployeeSessionContainer {
        if let existing = self.containers[account.accountId] {
            return existing
        }
        let created = EmployeeSessionContainer(account: account)
        self.containers[account.accountId] = created
        return created
    }

    // MARK: Lifecycle

    /// Register a freshly authenticated account (add / login) and make it active.
    /// The caller has already populated the container's client jar (login cookies);
    /// this persists the account metadata + snapshots those cookies.
    @discardableResult
    func addOrLogin(_ account: EmployeeAccount) -> EmployeeSessionContainer {
        EmployeeAccountStore.upsert(account)
        if let index = self.accounts.firstIndex(where: { $0.accountId == account.accountId }) {
            self.accounts[index] = account
        } else {
            self.accounts.append(account)
        }
        let container = self.container(for: account)
        container.persistCookies()
        self.setActive(account.accountId)
        return container
    }

    /// Switch to another already-registered account. Clears no data; only flips the
    /// active pointer and (for the shell) re-mounts the target's container.
    func setActive(_ accountId: String) {
        guard self.accounts.contains(where: { $0.accountId == accountId }) else { return }
        self.activeAccountId = accountId
        EmployeeAccountStore.setActiveAccountId(accountId)
    }

    /// Switch org within the active account: keep the account, invalidate its embed
    /// WebView session, and let the shell re-bootstrap into the new org.
    func switchOrg(_ orgId: String?) async {
        guard let account = self.activeAccount else { return }
        EmployeeAccountStore.setActiveOrgId(orgId, for: account.accountId)
        if let index = self.accounts.firstIndex(where: { $0.accountId == account.accountId }) {
            self.accounts[index].activeOrgId = orgId
        }
        await self.container(for: account).invalidateEmbedSession()
    }

    /// Log out of the current account: clear both jars + cache and delete the credential.
    /// Node pairing is untouched. Active pointer moves to another account (or nil).
    func logout() async {
        guard let account = self.activeAccount else { return }
        await self.container(for: account).clearSessionForLogout()
        self.containers[account.accountId] = nil
        EmployeeAccountStore.setActiveOrgId(nil, for: account.accountId)
        EmployeeAccountStore.deleteCredential(for: account.accountId)
        // Keep the account in the list (metadata) but drop it as active. Callers that
        // want a full removal use `removeAccount`.
        self.activeAccountId = self.accounts.first(where: { $0.accountId != account.accountId })?.accountId
        EmployeeAccountStore.setActiveAccountId(self.activeAccountId)
    }

    /// Remove an account entirely (logout + delete namespaced data + destroy WebView store).
    func removeAccount(_ accountId: String) async {
        if let account = self.accounts.first(where: { $0.accountId == accountId }) {
            await self.container(for: account).clearSessionForLogout()
            await EmployeeSessionContainer.destroyWebDataStore(id: account.webDataStoreId)
        }
        self.containers[accountId] = nil
        EmployeeAccountStore.remove(accountId: accountId)
        self.reload()
    }
}
