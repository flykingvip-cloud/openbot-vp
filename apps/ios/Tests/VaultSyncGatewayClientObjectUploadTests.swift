import Foundation
import Testing
@testable import OpenBot

private final class MockVaultSyncRpc: VaultSyncRpcClient, @unchecked Sendable {
    var wsChunkCalls = 0
    var objectPutURL: URL?

    func request(method: String, paramsJSON: String) async throws -> Data {
        switch method {
        case "knowledge.vault-sync.blobs.upload-session.create":
            let url = self.objectPutURL?.absoluteString ?? "https://object.test/put"
            let json =
                """
                {
                  "session": {"uploadId":"up-s3","chunkSize":262144,"chunkCount":5},
                  "objectUpload": {
                    "backend": "s3",
                    "put": {
                      "url": "\(url)",
                      "headers": {"content-type": "application/octet-stream"}
                    }
                  },
                  "httpUpload": {
                    "token": "tok",
                    "chunkPutPathTemplate": "/__openbot/vault-sync/v1/{vaultId}/{uploadId}/chunks/{chunkIndex}"
                  }
                }
                """
            return Data(json.utf8)
        case "knowledge.vault-sync.blobs.upload-session.complete":
            return Data(#"{"blobId":"up-s3"}"#.utf8)
        case "knowledge.vault-sync.blobs.upload-session.put-chunk":
            self.wsChunkCalls += 1
            return Data("{}".utf8)
        default:
            throw VaultSyncRunnerError.badResponse
        }
    }
}

private final class ObjectUploadURLProtocol: URLProtocol {
    nonisolated(unsafe) static var lastPutBody: Data?

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "object.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        if request.httpMethod == "PUT" {
            Self.lastPutBody = request.httpBody
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite struct VaultSyncGatewayClientObjectUploadTests {
    @Test func storeCiphertextBlobPrefersObjectUploadOverHttpChunks() async throws {
        ObjectUploadURLProtocol.lastPutBody = nil
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ObjectUploadURLProtocol.self]
        let session = URLSession(configuration: config)

        let rpc = MockVaultSyncRpc()
        rpc.objectPutURL = URL(string: "https://object.test/put")!

        let client = VaultSyncGatewayClient(
            rpc: rpc,
            httpOriginProvider: { "https://gw.example:18789/" },
            urlSession: session
        )
        var ciphertext = Data(repeating: 9, count: VaultSyncConstants.directPutMaxBytes + 128)
        let hash = VaultSyncCrypto.sha256Hex(ciphertext)
        let blobId = try await client.storeCiphertextBlob(
            vaultId: "vault-1",
            deviceId: "device-a",
            ciphertextHash: hash,
            ciphertext: ciphertext
        )
        #expect(blobId == "up-s3")
        #expect(rpc.wsChunkCalls == 0)
        #expect(ObjectUploadURLProtocol.lastPutBody == ciphertext)
    }
}
