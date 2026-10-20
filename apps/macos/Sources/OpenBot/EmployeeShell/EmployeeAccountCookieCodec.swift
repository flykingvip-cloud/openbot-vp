//
//  EmployeeAccountCookieCodec.swift
//  Serialize/deserialize a Client Session Jar's cookies for the secure store
//  (task 1.3-macos). Pure + testable (no Keychain / URLSession).
//
//  The client session jar holds the employee platform-auth login cookie that
//  `mint` must carry. We persist it in the Keychain (credential field) and
//  rehydrate it into a per-account, isolated `URLSession` cookie storage — never
//  `URLSession.shared` (contract invariant 1) and never a cross-account jar.
//

import Foundation

enum EmployeeAccountCookieCodec {
    /// Encode cookies to plist `Data` (property lists preserve Date/URL fidelity
    /// better than JSON). Returns nil when there is nothing to persist.
    static func encode(_ cookies: [HTTPCookie]) -> Data? {
        let payload: [[String: Any]] = cookies.compactMap { cookie in
            guard let properties = cookie.properties else { return nil }
            // HTTPCookiePropertyKey is a String rawValue; remap to plain String keys.
            var dict: [String: Any] = [:]
            for (key, value) in properties {
                dict[key.rawValue] = value
            }
            return dict
        }
        guard !payload.isEmpty else { return nil }
        return try? PropertyListSerialization.data(
            fromPropertyList: payload, format: .binary, options: 0)
    }

    /// Decode cookies previously produced by `encode`. Malformed entries are skipped.
    static func decode(_ data: Data) -> [HTTPCookie] {
        guard
            let list = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
            let array = list as? [[String: Any]]
        else {
            return []
        }
        return array.compactMap { dict in
            var properties: [HTTPCookiePropertyKey: Any] = [:]
            for (key, value) in dict {
                properties[HTTPCookiePropertyKey(rawValue: key)] = value
            }
            return HTTPCookie(properties: properties)
        }
    }
}
