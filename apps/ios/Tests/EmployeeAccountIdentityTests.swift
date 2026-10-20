import Foundation
import Testing
@testable import OpenBot

@Suite struct EmployeeAccountIdentityTests {
    // Golden vector: first 16 hex of sha256("https://www.openbot.love\nuser@example.com").
    // `gw.openbot.love` is a compatibility alias and must hash to the same id.
    private static let goldenBaseURL = "https://www.openbot.love"
    private static let goldenEmail = "user@example.com"
    private static let goldenId = "3c8e90401dd25d46"

    @Test func accountIdMatchesContractGoldenVector() {
        let id = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: Self.goldenBaseURL, userEmail: Self.goldenEmail)
        #expect(id == Self.goldenId)
        #expect(id.count == 16)
    }

    @Test func accountIdIsStableAndRecomputable() {
        let url = URL(string: Self.goldenBaseURL)!
        let a = EmployeeAccountIdentity.accountId(gatewayBaseURL: url, userEmail: Self.goldenEmail)
        let b = EmployeeAccountIdentity.accountId(gatewayBaseURL: url, userEmail: Self.goldenEmail)
        #expect(a == b)
        #expect(a == Self.goldenId)
    }

    @Test func accountIdIsCaseInsensitiveAndTrimmed() {
        let lower = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: Self.goldenBaseURL, userEmail: Self.goldenEmail)
        let mixed = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: "  HTTPS://GW.OpenBot.Love  ", userEmail: "  User@Example.com  ")
        #expect(lower == mixed)
    }

    @Test func accountIdTreatsLegacyGwHostAsWww() {
        let www = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: "https://www.openbot.love", userEmail: Self.goldenEmail)
        let gw = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: "https://gw.openbot.love", userEmail: Self.goldenEmail)
        #expect(www == gw)
        #expect(www == Self.goldenId)
    }

    @Test func accountIdDiffersByGatewayAndEmail() {
        let base = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: Self.goldenBaseURL, userEmail: Self.goldenEmail)
        let otherGateway = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: "https://self.hosted.example", userEmail: Self.goldenEmail)
        let otherEmail = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: Self.goldenBaseURL, userEmail: "other@example.com")
        #expect(base != otherGateway)
        #expect(base != otherEmail)
    }

    @Test func accountIdNeverContainsPlaintextEmail() {
        let id = EmployeeAccountIdentity.accountId(
            gatewayBaseURLString: Self.goldenBaseURL, userEmail: Self.goldenEmail)
        #expect(!id.contains("user"))
        #expect(!id.contains("@"))
    }

    @Test func accountInitDerivesId() {
        let account = EmployeeAccount(
            gatewayBaseURL: URL(string: Self.goldenBaseURL)!, userEmail: Self.goldenEmail)
        #expect(account.accountId == Self.goldenId)
        #expect(account.id == account.accountId)
    }
}
