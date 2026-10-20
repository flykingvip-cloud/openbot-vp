import { type Static, Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

/**
 * Wire shape of a signed capability.
 *
 * `claimsJSON` travels as a string rather than a nested object on purpose: the
 * signature covers those exact bytes, so re-serializing a parsed object would risk
 * a different byte sequence and a false verification failure.
 */
export const SignedCapabilitySchema = Type.Object(
  {
    alg: Type.String({ enum: ["Ed25519"] }),
    keyId: NonEmptyString,
    claimsJSON: NonEmptyString,
    signature: NonEmptyString,
  },
  { additionalProperties: false },
);

/**
 * Params for `localFiles.redeem`.
 *
 * Note there is no `nonce` field and no `nodeId` field. The node submits the whole
 * capability, because a bare nonce carries nothing to verify or bind; and the node
 * id is taken from the authenticated connection rather than the request body.
 * Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md section 9.3.
 */
export const LocalFilesRedeemParamsSchema = Type.Object(
  {
    capability: SignedCapabilitySchema,
    operation: Type.String({
      enum: ["fs.stat", "fs.list", "fs.read", "archive.list", "archive.readEntry"],
    }),
  },
  { additionalProperties: false },
);

/**
 * Keyset document pushed from gateway to node over the authenticated connection.
 *
 * `trustRootPublicKey` is only consumed on a node's very first pairing, to pin the
 * root. After pinning, the node verifies updates against the pinned root and
 * ignores this field, so a later push cannot swap the root out.
 */
export const LocalFilesKeysetEventSchema = Type.Object(
  {
    trustRootKeyId: NonEmptyString,
    trustRootPublicKey: NonEmptyString,
    documentJSON: NonEmptyString,
    signature: NonEmptyString,
  },
  { additionalProperties: false },
);

export type SignedCapabilityWire = Static<typeof SignedCapabilitySchema>;
export type LocalFilesRedeemParams = Static<typeof LocalFilesRedeemParamsSchema>;
export type LocalFilesKeysetEvent = Static<typeof LocalFilesKeysetEventSchema>;
