import Foundation
import Testing
@testable import OpenBot

@Suite struct EmployeeAccountTests {
    @Test func `accountId is stable and case-insensitive`() {
        let a = EmployeeAccount.computeAccountId(
            gatewayBaseURL: "https://GW.OpenBot.love/", userEmail: "A@X.com")
        let b = EmployeeAccount.computeAccountId(
            gatewayBaseURL: "https://gw.openbot.love", userEmail: "a@x.com")
        let c = EmployeeAccount.computeAccountId(
            gatewayBaseURL: "https://www.openbot.love", userEmail: "a@x.com")
        #expect(a == b)
        #expect(b == c)
        #expect(a.count == 16)
    }

    @Test func `accountId never embeds email plaintext`() {
        let id = EmployeeAccount.computeAccountId(
            gatewayBaseURL: "https://gw.openbot.love", userEmail: "secret@example.com")
        #expect(!id.contains("secret"))
        #expect(!id.contains("@"))
    }

    @Test func `init computes matching accountId`() {
        let account = EmployeeAccount(
            gatewayBaseURL: URL(string: "https://gw.openbot.love")!, userEmail: "a@x.com")
        #expect(account.accountId == EmployeeAccount.computeAccountId(
            gatewayBaseURL: "https://gw.openbot.love", userEmail: "a@x.com"))
    }

    @Test func `key schema is namespaced by accountId`() {
        let id = "abc123def456"
        #expect(EmployeeAccountKeys.secretsKey(id) == "openbot.account.abc123def456.secrets")
        #expect(EmployeeAccountKeys.legacyKey(id, .credential) == "openbot.account.abc123def456.credential")
        #expect(EmployeeAccountKeys.accountKeyPrefix(id) == "openbot.account.abc123def456.")
        #expect(EmployeeAccountKeys.profileDefaultsKey(id) == "openbot.employee.account.profile.abc123def456")
        #expect(EmployeeAccountKeys.activeAccountKey == "openbot.active-account")
    }

    @Test func `profile and secrets Codable round-trip`() throws {
        let profile = EmployeeAccountProfile(
            userEmail: "a@x.com",
            gatewayBaseURL: "https://gw.openbot.love",
            activeOrgId: "org-1",
            webDataStoreId: UUID().uuidString)
        let profileData = try JSONEncoder().encode(profile)
        let profileDecoded = try JSONDecoder().decode(EmployeeAccountProfile.self, from: profileData)
        #expect(profileDecoded == profile)

        let secrets = EmployeeAccountSecrets(credential: "base64cookies", pushToken: "tok")
        let secretsData = try JSONEncoder().encode(secrets)
        let secretsDecoded = try JSONDecoder().decode(EmployeeAccountSecrets.self, from: secretsData)
        #expect(secretsDecoded == secrets)
    }

    @Test func `cookie codec round-trips`() {
        let cookie = HTTPCookie(properties: [
            .name: "session",
            .value: "abc",
            .domain: "gw.openbot.love",
            .path: "/",
        ])!
        let data = EmployeeAccountCookieCodec.encode([cookie])
        #expect(data != nil)
        let decoded = EmployeeAccountCookieCodec.decode(data!)
        #expect(decoded.count == 1)
        #expect(decoded.first?.name == "session")
        #expect(decoded.first?.value == "abc")
    }

    @Test func `cookie codec returns nil for empty`() {
        #expect(EmployeeAccountCookieCodec.encode([]) == nil)
        #expect(EmployeeAccountCookieCodec.decode(Data()).isEmpty)
    }
}
