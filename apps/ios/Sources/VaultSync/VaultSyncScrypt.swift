import Foundation
import CommonCrypto

/// Compact scrypt (RFC 7914) for vault-sync password KDF. Matches `@noble/hashes/scrypt`.
enum VaultSyncScrypt {
    static func derive(
        password: Data,
        salt: Data,
        N: Int = 16384,
        r: Int = 8,
        p: Int = 1,
        dkLen: Int = 32
    ) throws -> Data {
        precondition(N > 1 && (N & (N - 1)) == 0, "N must be power of 2")
        precondition(r > 0 && p > 0 && dkLen > 0)
        let blockSize = 128 * r
        let B = try pbkdf2(password: password, salt: salt, iterations: 1, dkLen: blockSize * p)
        var BBytes = [UInt8](B)
        for i in 0..<p {
            let start = i * blockSize
            var block = Array(BBytes[start..<(start + blockSize)])
            try romix(block: &block, N: N, r: r)
            BBytes.replaceSubrange(start..<(start + blockSize), with: block)
        }
        return try pbkdf2(password: password, salt: Data(BBytes), iterations: 1, dkLen: dkLen)
    }

    private static func pbkdf2(password: Data, salt: Data, iterations: UInt32, dkLen: Int) throws -> Data {
        var derived = Data(count: dkLen)
        let status = derived.withUnsafeMutableBytes { derivedPtr in
            password.withUnsafeBytes { passPtr in
                salt.withUnsafeBytes { saltPtr in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passPtr.bindMemory(to: Int8.self).baseAddress,
                        password.count,
                        saltPtr.bindMemory(to: UInt8.self).baseAddress,
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        iterations,
                        derivedPtr.bindMemory(to: UInt8.self).baseAddress,
                        dkLen
                    )
                }
            }
        }
        guard status == kCCSuccess else {
            throw VaultSyncCryptoError.kdfFailed
        }
        return derived
    }

    private static func romix(block: inout [UInt8], N: Int, r: Int) throws {
        let blockSize = 128 * r
        var X = block
        var V = [[UInt8]](repeating: [UInt8](repeating: 0, count: blockSize), count: N)
        for i in 0..<N {
            V[i] = X
            blockMix(block: &X, r: r)
        }
        for _ in 0..<N {
            let j = Int(integerify(X, r: r) % UInt64(N))
            xor(&X, V[j])
            blockMix(block: &X, r: r)
        }
        block = X
    }

    private static func blockMix(block: inout [UInt8], r: Int) {
        var X = Array(block[(block.count - 64)...])
        var Y = [UInt8](repeating: 0, count: block.count)
        for i in 0..<(2 * r) {
            let start = i * 64
            xor(&X, Array(block[start..<(start + 64)]))
            salsa20_8(&X)
            let dest = (i % 2 == 0 ? i / 2 : r + (i - 1) / 2) * 64
            Y.replaceSubrange(dest..<(dest + 64), with: X)
        }
        block = Y
    }

    private static func integerify(_ block: [UInt8], r: Int) -> UInt64 {
        let offset = (2 * r - 1) * 64
        var value: UInt64 = 0
        for i in 0..<8 {
            value |= UInt64(block[offset + i]) << (8 * i)
        }
        return value
    }

    private static func xor(_ a: inout [UInt8], _ b: [UInt8]) {
        for i in 0..<a.count {
            a[i] ^= b[i]
        }
    }

    private static func salsa20_8(_ b: inout [UInt8]) {
        func rotl(_ x: UInt32, _ n: UInt32) -> UInt32 { (x << n) | (x >> (32 - n)) }
        var x = [UInt32](repeating: 0, count: 16)
        for i in 0..<16 {
            let o = i * 4
            x[i] =
                UInt32(b[o]) |
                (UInt32(b[o + 1]) << 8) |
                (UInt32(b[o + 2]) << 16) |
                (UInt32(b[o + 3]) << 24)
        }
        var w = x
        for _ in 0..<4 {
            w[4] ^= rotl(w[0] &+ w[12], 7)
            w[8] ^= rotl(w[4] &+ w[0], 9)
            w[12] ^= rotl(w[8] &+ w[4], 13)
            w[0] ^= rotl(w[12] &+ w[8], 18)
            w[9] ^= rotl(w[5] &+ w[1], 7)
            w[13] ^= rotl(w[9] &+ w[5], 9)
            w[1] ^= rotl(w[13] &+ w[9], 13)
            w[5] ^= rotl(w[1] &+ w[13], 18)
            w[14] ^= rotl(w[10] &+ w[6], 7)
            w[2] ^= rotl(w[14] &+ w[10], 9)
            w[6] ^= rotl(w[2] &+ w[14], 13)
            w[10] ^= rotl(w[6] &+ w[2], 18)
            w[3] ^= rotl(w[15] &+ w[11], 7)
            w[7] ^= rotl(w[3] &+ w[15], 9)
            w[11] ^= rotl(w[7] &+ w[3], 13)
            w[15] ^= rotl(w[11] &+ w[7], 18)
            w[1] ^= rotl(w[0] &+ w[3], 7)
            w[2] ^= rotl(w[1] &+ w[0], 9)
            w[3] ^= rotl(w[2] &+ w[1], 13)
            w[0] ^= rotl(w[3] &+ w[2], 18)
            w[6] ^= rotl(w[5] &+ w[4], 7)
            w[7] ^= rotl(w[6] &+ w[5], 9)
            w[4] ^= rotl(w[7] &+ w[6], 13)
            w[5] ^= rotl(w[4] &+ w[7], 18)
            w[11] ^= rotl(w[10] &+ w[9], 7)
            w[8] ^= rotl(w[11] &+ w[10], 9)
            w[9] ^= rotl(w[8] &+ w[11], 13)
            w[10] ^= rotl(w[9] &+ w[8], 18)
            w[12] ^= rotl(w[15] &+ w[14], 7)
            w[13] ^= rotl(w[12] &+ w[15], 9)
            w[14] ^= rotl(w[13] &+ w[12], 13)
            w[15] ^= rotl(w[14] &+ w[13], 18)
        }
        for i in 0..<16 {
            let v = x[i] &+ w[i]
            let o = i * 4
            b[o] = UInt8(v & 0xff)
            b[o + 1] = UInt8((v >> 8) & 0xff)
            b[o + 2] = UInt8((v >> 16) & 0xff)
            b[o + 3] = UInt8((v >> 24) & 0xff)
        }
    }
}
