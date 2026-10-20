import Foundation
import Testing
@testable import OpenBot

@Suite struct VaultSyncCryptoTests {
    @Test func unlockAndOpaquePathMatchBrowserVectors() throws {
        let password = "correct horse battery staple"
        let saltHex = "00112233445566778899aabbccddeeff"
        let keys = try VaultSyncCrypto.unlockVaultKeys(
            password: password,
            saltB64: VaultSyncCrypto.bytesToBase64(VaultSyncCrypto.hexToBytes(saltHex))
        )
        #expect(
            VaultSyncCrypto.bytesToHex(keys.contentKeyBytes)
                == "501715d6aa975b61296e14f9b5793ea433a2c823dae5d5c830d9216be07f8c81"
        )
        #expect(
            VaultSyncCrypto.bytesToHex(keys.metadataKeyBytes)
                == "90223ae447a1f5d4ea7e5c1c75be2f07b881c5177da3f171341435f4b1ddc85d"
        )
        #expect(
            VaultSyncCrypto.bytesToHex(keys.pathLookupKey)
                == "c884d15da7ce2cb98afce453721c61fff0f6aca4835b7ba390205e83308f52ae"
        )
        let opaque = try VaultSyncCrypto.computeOpaquePathId(
            pathLookupKey: keys.pathLookupKey,
            relativePath: "notes/welcome.md"
        )
        #expect(opaque == "q4hCoWXTK-s2rbCe6NVEPF6iRh4hQv-4BpHtb_OW1P4")
    }

    @Test func encryptAeadMatchesBrowserVectorWithFixedNonce() throws {
        let password = "correct horse battery staple"
        let saltHex = "00112233445566778899aabbccddeeff"
        let keys = try VaultSyncCrypto.unlockVaultKeys(
            password: password,
            saltB64: VaultSyncCrypto.bytesToBase64(VaultSyncCrypto.hexToBytes(saltHex))
        )
        let vaultId = "11111111-1111-1111-1111-111111111111"
        let opaquePathId = try VaultSyncCrypto.computeOpaquePathId(
            pathLookupKey: keys.pathLookupKey,
            relativePath: "notes/welcome.md"
        )
        let nonce = Data(repeating: 7, count: 12)
        let body = try VaultSyncCrypto.encryptAead(
            key: keys.contentKey,
            plaintext: VaultSyncCrypto.utf8("hello vault sync"),
            vaultId: vaultId,
            opaquePathId: opaquePathId,
            revisionId: "rev-fixed-for-aad",
            encryptionVersion: 1,
            nonce: nonce
        )
        #expect(
            VaultSyncCrypto.bytesToHex(body)
                == "0707070707070707070707077752da5b4d6ff7ffaf6311e42602ef2d215b44b1782ec80f933a6facc9a53e10"
        )
        #expect(
            VaultSyncCrypto.sha256Hex(body)
                == "478b316e5a0a892a0b996a6ee3d976fac236c4b19ba01143d97d98492ca6e9d1"
        )
        let plain = try VaultSyncCrypto.decryptAead(
            key: keys.contentKey,
            ciphertext: body,
            vaultId: vaultId,
            opaquePathId: opaquePathId,
            revisionId: "rev-fixed-for-aad"
        )
        #expect(String(data: plain, encoding: .utf8) == "hello vault sync")
    }
}
