/**
 * Browser-side team wrap/invite crypto (R1). Uses Web Crypto X25519 + AES-GCM.
 */
import { base64ToBytes, asBufferSource, bytesToBase64, concatBytes, utf8Encode } from "./bytes.ts";
import { generateVaultSalt } from "./client-crypto.ts";

const NONCE_LEN = 12;
const TAG_LEN = 16;
const WRAP_INFO = utf8Encode("openbot-vault-sync/member-wrap/v1");

export type MemberKeyPair = {
  publicKeyB64: string;
  privateKeyB64: string;
};

export type WrappedBaseKeyPackage = {
  ephemeralPublicKeyB64: string;
  wrappedBaseKeyB64: string;
  keyEpoch: number;
};

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, asBufferSource(data)));
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  const blocks: Uint8Array[] = [];
  let prev = new Uint8Array(0);
  let counter = 1;
  while (concatBytes(...blocks).length < length) {
    const block = await hmacSha256(prk, concatBytes(prev, info, new Uint8Array([counter])));
    blocks.push(asBufferSource(block));
    prev = asBufferSource(block);
    counter += 1;
  }
  return asBufferSource(concatBytes(...blocks).subarray(0, length));
}

function buildWrapAad(params: {
  vaultId: string;
  memberAccountId: string;
  keyEpoch: number;
}): Uint8Array {
  return utf8Encode(
    `${params.vaultId}|${params.memberAccountId}|${params.keyEpoch}|member-wrap-v1`,
  );
}

async function deriveWrapKey(sharedSecret: Uint8Array, vaultId: string): Promise<Uint8Array> {
  return hkdfSha256(sharedSecret, utf8Encode(vaultId), WRAP_INFO, 32);
}

export async function generateMemberKeyPair(): Promise<MemberKeyPair> {
  const keyPair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  return {
    publicKeyB64: bytesToBase64(publicKeySpki),
    privateKeyB64: bytesToBase64(privateKeyPkcs8),
  };
}

async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    asBufferSource(base64ToBytes(publicKeyB64)),
    { name: "X25519" },
    false,
    [],
  );
}

async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function wrapBaseKeyForMember(params: {
  baseKey: Uint8Array;
  recipientPublicKeyB64: string;
  vaultId: string;
  memberAccountId: string;
  keyEpoch: number;
}): Promise<WrappedBaseKeyPackage> {
  if (params.baseKey.length !== 32) {
    throw new Error("invalid base key");
  }
  const recipient = await importPublicKey(params.recipientPublicKeyB64);
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const shared = await deriveSharedSecret(ephemeral.privateKey, recipient);
  const wrapKey = await deriveWrapKey(shared, params.vaultId);
  const nonce = generateVaultSalt(NONCE_LEN);
  const aad = buildWrapAad(params);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(wrapKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LEN * 8,
    },
    cryptoKey,
    asBufferSource(params.baseKey),
  );
  const ephemeralSpki = new Uint8Array(await crypto.subtle.exportKey("spki", ephemeral.publicKey));
  return {
    ephemeralPublicKeyB64: bytesToBase64(ephemeralSpki),
    wrappedBaseKeyB64: bytesToBase64(concatBytes(nonce, new Uint8Array(encrypted))),
    keyEpoch: params.keyEpoch,
  };
}

export function generateInviteSecret(): string {
  const bytes = generateVaultSalt(24);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateInviteSalt(): Uint8Array {
  return generateVaultSalt(16);
}

export async function wrapBaseKeyWithInviteSecret(params: {
  baseKey: Uint8Array;
  inviteSecret: string;
  inviteSalt: Uint8Array;
  vaultId: string;
  inviteId: string;
  keyEpoch: number;
}): Promise<{ wrappedBaseKeyB64: string }> {
  const wrapKey = await hmacSha256(
    params.inviteSalt,
    concatBytes(utf8Encode(params.inviteSecret), utf8Encode("|invite-wrap-v1")),
  );
  const nonce = generateVaultSalt(NONCE_LEN);
  const aad = utf8Encode(`${params.vaultId}|${params.inviteId}|${params.keyEpoch}|invite-wrap-v1`);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(wrapKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LEN * 8,
    },
    cryptoKey,
    asBufferSource(params.baseKey),
  );
  return {
    wrappedBaseKeyB64: bytesToBase64(concatBytes(nonce, new Uint8Array(encrypted))),
  };
}

export async function unwrapBaseKeyWithInviteSecret(params: {
  wrappedBaseKeyB64: string;
  inviteSecret: string;
  inviteSaltB64: string;
  vaultId: string;
  inviteId: string;
  keyEpoch: number;
}): Promise<Uint8Array> {
  const wrapKey = await hmacSha256(
    base64ToBytes(params.inviteSaltB64),
    concatBytes(utf8Encode(params.inviteSecret), utf8Encode("|invite-wrap-v1")),
  );
  const blob = base64ToBytes(params.wrappedBaseKeyB64);
  const nonce = blob.slice(0, NONCE_LEN);
  const payload = blob.slice(NONCE_LEN);
  const aad = utf8Encode(`${params.vaultId}|${params.inviteId}|${params.keyEpoch}|invite-wrap-v1`);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(wrapKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(aad),
        tagLength: TAG_LEN * 8,
      },
      cryptoKey,
      asBufferSource(payload),
    );
    const out = new Uint8Array(plain);
    if (out.length !== 32) {
      throw new Error("bad length");
    }
    return out;
  } catch {
    throw new Error("unwrap failed");
  }
}

export async function deriveBaseKeyFromPassword(params: {
  password: string;
  saltB64: string;
  kdf?: import("./client-crypto.ts").ScryptKdfParams;
}): Promise<Uint8Array> {
  const { deriveBaseKey } = await import("./client-crypto.ts");
  return deriveBaseKey({
    password: params.password,
    salt: base64ToBytes(params.saltB64),
    kdf: params.kdf,
  });
}
