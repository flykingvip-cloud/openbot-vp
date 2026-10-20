import Foundation
import Testing
@testable import OpenBotKit

@Suite struct GenericPasswordKeychainStoreTests {
    @Test func saveUpdateLoadDeleteRoundTrip() throws {
        let service = "ai.openbot.tests.keychain.\(UUID().uuidString)"
        let account = "session-bundle"

        #expect(GenericPasswordKeychainStore.delete(service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == nil)

        #expect(GenericPasswordKeychainStore.saveString("first", service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == "first")

        // Second save must update in place (SecItemUpdate path), not fail.
        #expect(GenericPasswordKeychainStore.saveString("second", service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadString(service: service, account: account) == "second")

        let payload = Data(#"{"cookieHeaderValue":"a=b","session":{"userId":"u","email":"e","displayName":"n","scopes":[]}}"#.utf8)
        #expect(GenericPasswordKeychainStore.saveData(payload, service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadData(service: service, account: account) == payload)

        #expect(GenericPasswordKeychainStore.delete(service: service, account: account))
        #expect(GenericPasswordKeychainStore.loadData(service: service, account: account) == nil)
    }
}
