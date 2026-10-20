import { describe, expect, it } from "vitest";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../infra/node-commands.js";
import { capabilityDigest, signCapability, verifyCapability } from "./capability.js";
import { LocalDeviceBindingStore } from "./device-binding.js";
import { deriveInvocationCapability, issueTurnAuthorization } from "./issue.js";
import {
  generateCapabilitySigningKey,
  NodeCapabilityKeyset,
  signKeysetDocument,
  verificationKeyFor,
} from "./keyset.js";
import { buildRedemptionKey, NonceLedger } from "./nonce-ledger.js";
import {
  redeemInvocationCapability,
  StaticCapabilityKeyResolver,
  verifyRedemption,
  type RedemptionDeps,
} from "./redemption.js";
import { TurnAuthorizationStore } from "./turn-authorization.js";
import {
  CAPABILITY_CLOCK_SKEW_MS,
  LOCAL_FILES_LIMITS,
  LOCAL_FILES_READONLY_PROFILE,
  type CapabilityBinding,
  type FileIdentity,
} from "./types.js";

const NOW = 1_800_000_000_000;

const DEVICE_PUBLIC_KEY = "device-pub-key-aaa";
const NODE_ID = "node-aaa";

function makeBinding(overrides: Partial<CapabilityBinding> = {}): CapabilityBinding {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "bot-skill",
    sessionKey: "session-1",
    turnId: "turn-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_PUBLIC_KEY,
    ...overrides,
  };
}

const FILE_ID: FileIdentity = { dev: "16777220", ino: "99001" };

function makeHarness(opts?: { budgetCalls?: number; maxEntriesRead?: number }) {
  const signingKey = generateCapabilitySigningKey();
  const keyResolver = new StaticCapabilityKeyResolver([verificationKeyFor(signingKey)]);
  const turnAuthorizations = new TurnAuthorizationStore();
  const bindings = new LocalDeviceBindingStore();
  const nonces = new NonceLedger();

  bindings.put({
    tenantId: "tenant-1",
    userId: "user-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_PUBLIC_KEY,
    allowedAgentIds: ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: NOW - 1000,
  });

  const deps: RedemptionDeps = { keyResolver, turnAuthorizations, bindings, nonces };

  const issued = issueTurnAuthorization({
    binding: makeBinding(),
    canonicalPath: "/Users/demo/Desktop/pack.zip",
    fileId: FILE_ID,
    targetKind: "file",
    operations: ["archive.list", "archive.readEntry"],
    grantSource: "user-directed",
    budget:
      opts?.budgetCalls || opts?.maxEntriesRead
        ? {
            maxCalls: opts.budgetCalls ?? 32,
            maxEntriesRead: opts.maxEntriesRead ?? 30,
            maxTotalExpandedBytes: 5_242_880,
          }
        : undefined,
    signingKey,
    store: turnAuthorizations,
    nowMs: NOW,
    expiresAtMs: NOW + 120_000,
  });
  if (!issued.ok) {
    throw new Error(`fixture failed: ${issued.reason}`);
  }
  const authorization = issued;

  function derive(operation: "archive.list" | "archive.readEntry", entryPath?: string) {
    const derived = deriveInvocationCapability({
      authorizationId: authorization.claims.authorizationId,
      operation,
      archiveEntryPath: entryPath,
      signingKey,
      store: turnAuthorizations,
      nowMs: NOW,
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    if (!derived.ok) {
      throw new Error(`derive failed: ${derived.reason}`);
    }
    return derived;
  }

  return {
    signingKey,
    keyResolver,
    turnAuthorizations,
    bindings,
    nonces,
    deps,
    authorization,
    derive,
    connection: {
      nodeId: NODE_ID,
      devicePublicKey: DEVICE_PUBLIC_KEY,
      authenticated: true,
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    },
  };
}

describe("redemption: happy path and single use", () => {
  it("redeems once and refuses the same capability a second time (acceptance 6.10 replay, 9.6 case 4)", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const first = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(first.ok).toBe(true);

    // A restarted node replaying the still-unexpired capability must fail: the
    // consumption record lives on the gateway, not in node memory.
    const replay = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW + 5_000,
    );
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.reason).toBe("nonce-already-consumed");
  });

  it("allows a bounded ZIP task several distinct calls with distinct nonces (9.6 case 2)", () => {
    const h = makeHarness();
    const list = h.derive("archive.list");
    const entryA = h.derive("archive.readEntry", "skills/a.md");
    const entryB = h.derive("archive.readEntry", "skills/b.md");

    expect(new Set([list.claims.nonce, entryA.claims.nonce, entryB.claims.nonce]).size).toBe(3);

    for (const [cap, op] of [
      [list, "archive.list"],
      [entryA, "archive.readEntry"],
      [entryB, "archive.readEntry"],
    ] as const) {
      const res = redeemInvocationCapability(
        { capability: cap.signed, connection: h.connection, operation: op },
        h.deps,
        NOW,
      );
      expect(res.ok).toBe(true);
    }
  });

  it("redeems fs.list for a paired computer whose session profile is unset", () => {
    const h = makeHarness();
    const issued = issueTurnAuthorization({
      binding: makeBinding(),
      canonicalPath: "/Users/demo/Desktop",
      fileId: FILE_ID,
      targetKind: "directory",
      operations: ["fs.list"],
      grantSource: "user-approved-once",
      budget: { maxCalls: 1, maxEntriesRead: 1, maxTotalExpandedBytes: 2 * 1024 * 1024 },
      signingKey: h.signingKey,
      store: h.turnAuthorizations,
      nowMs: NOW,
      expiresAtMs: NOW + 120_000,
    });
    if (!issued.ok) {
      throw new Error(issued.reason);
    }
    const derived = deriveInvocationCapability({
      authorizationId: issued.claims.authorizationId,
      operation: "fs.list",
      signingKey: h.signingKey,
      store: h.turnAuthorizations,
      nowMs: NOW,
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    if (!derived.ok) {
      throw new Error(derived.reason);
    }
    const res = redeemInvocationCapability(
      {
        capability: derived.signed,
        connection: {
          ...h.connection,
          capabilityProfile: undefined,
          declaredCommands: [
            "browser.proxy",
            "system.run",
            "system.run.prepare",
            "system.which",
            ...NODE_LOCAL_FILES_READONLY_COMMANDS,
          ],
        },
        operation: "fs.list",
      },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(true);
    expect(!res.ok && res.reason).not.toBe("connection-identity-mismatch");
  });
});

describe("redemption: bare nonce or tampered capability (acceptance 6.10 forgery, 9.6 case 11)", () => {
  it("rejects a capability whose claims were modified after signing", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const tamperedClaims = {
      ...derived.claims,
      canonicalPath: "/Users/demo/.ssh/id_ed25519",
    };
    const tampered = {
      ...derived.signed,
      claimsJSON: JSON.stringify(tamperedClaims),
    };

    const res = redeemInvocationCapability(
      { capability: tampered, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("capability-invalid");
    expect(!res.ok && res.detail).toBe("bad-signature");
  });

  it("does not mark the nonce consumed when verification fails", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    // Same nonce, but presented on a capability signed by a foreign key.
    const foreignKey = generateCapabilitySigningKey("evil");
    const forged = signCapability(derived.claims, foreignKey);

    const rejected = redeemInvocationCapability(
      { capability: forged, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(rejected.ok).toBe(false);
    expect(h.nonces.size()).toBe(0);

    // The legitimate capability must still redeem: the failed attempt did not
    // pre-poison the consumption record.
    const legit = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(legit.ok).toBe(true);
  });

  it("rejects a redemption arriving from the wrong node connection", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const res = redeemInvocationCapability(
      {
        capability: derived.signed,
        connection: {
          nodeId: "node-other",
          devicePublicKey: DEVICE_PUBLIC_KEY,
          authenticated: true,
          capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
          declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
        },
        operation: "archive.list",
      },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("node-mismatch");
    expect(h.nonces.size()).toBe(0);
  });

  it("rejects a connection whose authenticated device key differs from the binding", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const res = redeemInvocationCapability(
      {
        capability: derived.signed,
        connection: {
          nodeId: NODE_ID,
          devicePublicKey: "other-key",
          authenticated: true,
          capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
          declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
        },
        operation: "archive.list",
      },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("device-key-mismatch");
  });

  it("rejects an unauthenticated connection", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const res = redeemInvocationCapability(
      {
        capability: derived.signed,
        connection: {
          nodeId: NODE_ID,
          devicePublicKey: DEVICE_PUBLIC_KEY,
          authenticated: false,
          capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
          declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
        },
        operation: "archive.list",
      },
      h.deps,
      NOW,
    );
    expect(!res.ok && res.reason).toBe("connection-not-authenticated");
  });

  it("rejects an operation that disagrees with the capability's own claim", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const res = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.readEntry" },
      h.deps,
      NOW,
    );
    expect(!res.ok && res.reason).toBe("operation-mismatch");
  });

  it("cannot redeem a read using a resolve ticket's nonce space", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");
    const digest = capabilityDigest(derived.signed.claimsJSON);

    const invocationKey = buildRedemptionKey({
      kind: "invocation",
      capabilityDigest: digest,
      nonce: derived.claims.nonce,
      nodeId: NODE_ID,
    });
    const resolveKey = buildRedemptionKey({
      kind: "resolve-ticket",
      capabilityDigest: digest,
      nonce: derived.claims.nonce,
      nodeId: NODE_ID,
    });
    expect(invocationKey).not.toBe(resolveKey);

    // Burning the resolve-ticket key leaves the invocation key untouched.
    h.nonces.consume(resolveKey, NOW + 30_000, NOW);
    const res = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(true);
  });
});

describe("redemption: concurrency (acceptance 6.10 double consume, 9.6 case 12)", () => {
  it("lets only the bound node succeed, and only once", async () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const bound = {
      nodeId: NODE_ID,
      devicePublicKey: DEVICE_PUBLIC_KEY,
      authenticated: true,
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    };
    const other = {
      nodeId: "node-bbb",
      devicePublicKey: "device-pub-key-bbb",
      authenticated: true,
      capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
      declaredCommands: [...NODE_LOCAL_FILES_READONLY_COMMANDS],
    };

    // Both attempts race on the same capability.
    const results = await Promise.all([
      Promise.resolve().then(() =>
        redeemInvocationCapability(
          { capability: derived.signed, connection: bound, operation: "archive.list" },
          h.deps,
          NOW,
        ),
      ),
      Promise.resolve().then(() =>
        redeemInvocationCapability(
          { capability: derived.signed, connection: other, operation: "archive.list" },
          h.deps,
          NOW,
        ),
      ),
    ]);

    const successes = results.filter((res) => res.ok);
    expect(successes).toHaveLength(1);
    const failure = results.find((res) => !res.ok);
    expect(failure && !failure.ok && failure.reason).toBe("node-mismatch");
  });

  it("lets only one of two concurrent redemptions by the bound node succeed", async () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const results = await Promise.all(
      [0, 1].map(() =>
        Promise.resolve().then(() =>
          redeemInvocationCapability(
            { capability: derived.signed, connection: h.connection, operation: "archive.list" },
            h.deps,
            NOW,
          ),
        ),
      ),
    );

    expect(results.filter((res) => res.ok)).toHaveLength(1);
    expect(
      results.filter((res) => !res.ok && res.reason === "nonce-already-consumed"),
    ).toHaveLength(1);
  });
});

describe("redemption: revoked or exhausted Turn authorization (9.6 case 13)", () => {
  it("fails when the Turn authorization was revoked, even though the capability is unexpired", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    h.turnAuthorizations.revoke(h.authorization.claims.authorizationId, NOW);

    // The capability itself still verifies.
    const stillValid = verifyCapability(derived.signed, {
      keyset: h.keyResolver,
      nowMs: NOW,
      expectedKind: "invocation",
    });
    expect(stillValid.ok).toBe(true);

    const res = redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("authorization-revoked");
    expect(h.nonces.size()).toBe(0);
  });

  it("refuses to mint a capability once maxCalls is spent (9.6 case 2)", () => {
    // The issuing gate: the gateway will not hand out more capabilities than the
    // turn's budget allows, so an exhausted budget stops work before a node call.
    const h = makeHarness({ budgetCalls: 1 });
    h.derive("archive.list");

    const second = deriveInvocationCapability({
      authorizationId: h.authorization.claims.authorizationId,
      operation: "archive.readEntry",
      archiveEntryPath: "skills/a.md",
      signingKey: h.signingKey,
      store: h.turnAuthorizations,
      nowMs: NOW,
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe("budget-exhausted");
  });

  it("refuses redemption once maxEntriesRead is spent, nonce unconsumed (9.6 case 2)", () => {
    // Redemption-side budget refusal: calls remain but entries do not.
    const h = makeHarness({ budgetCalls: 4, maxEntriesRead: 1 });
    const first = h.derive("archive.readEntry", "skills/a.md");
    const second = h.derive("archive.readEntry", "skills/b.md");

    expect(
      redeemInvocationCapability(
        { capability: first.signed, connection: h.connection, operation: "archive.readEntry" },
        h.deps,
        NOW,
      ).ok,
    ).toBe(true);

    const noncesAfterFirst = h.nonces.size();
    const res = redeemInvocationCapability(
      { capability: second.signed, connection: h.connection, operation: "archive.readEntry" },
      h.deps,
      NOW,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("budget-exhausted");
    // Budget failure must not consume the nonce.
    expect(h.nonces.size()).toBe(noncesAfterFirst);
  });

  it("stops deriving once maxTotalExpandedBytes is spent (9.6 case 2)", () => {
    const h = makeHarness();
    h.turnAuthorizations.recordBytes(h.authorization.claims.authorizationId, 5_242_880);

    const derived = deriveInvocationCapability({
      authorizationId: h.authorization.claims.authorizationId,
      operation: "archive.readEntry",
      archiveEntryPath: "skills/a.md",
      signingKey: h.signingKey,
      store: h.turnAuthorizations,
      nowMs: NOW,
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    expect(derived.ok).toBe(false);
    expect(!derived.ok && derived.reason).toBe("budget-exhausted");
  });
});

describe("the per-turn cumulative byte cap spans authorizations (acceptance 6.13)", () => {
  /**
   * A turn holds one authorization per resolved target, so the per-authorization
   * cap alone leaves the turn total unbounded. These build two authorizations in
   * one turn and check the second inherits what the first already spent.
   */
  function makeTurn(opts: { turnTotalByteCap: number; perAuthorizationBytes: number }) {
    const signingKey = generateCapabilitySigningKey();
    const turnAuthorizations = new TurnAuthorizationStore({
      turnTotalByteCap: opts.turnTotalByteCap,
    });

    function authorize(canonicalPath: string, ino: string) {
      const issued = issueTurnAuthorization({
        binding: makeBinding(),
        canonicalPath,
        fileId: { dev: "16777220", ino },
        targetKind: "file",
        operations: ["fs.read"],
        grantSource: "user-directed",
        budget: {
          maxCalls: 8,
          maxEntriesRead: 8,
          maxTotalExpandedBytes: opts.perAuthorizationBytes,
        },
        signingKey,
        store: turnAuthorizations,
        nowMs: NOW,
        expiresAtMs: NOW + 120_000,
      });
      if (!issued.ok) {
        throw new Error(`fixture failed: ${issued.reason}`);
      }
      return issued.claims.authorizationId;
    }

    function derive(authorizationId: string) {
      return deriveInvocationCapability({
        authorizationId,
        operation: "fs.read",
        signingKey,
        store: turnAuthorizations,
        nowMs: NOW,
        clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
      });
    }

    return { turnAuthorizations, authorize, derive };
  }

  it("refuses a second authorization's read once the turn total is spent", () => {
    // Each authorization carries its own fresh 4 MiB, and the turn allows 4 MiB
    // in total, so only the turn ledger can stop the second one.
    const turn = makeTurn({ turnTotalByteCap: 4_194_304, perAuthorizationBytes: 4_194_304 });
    const first = turn.authorize("/Users/demo/Desktop/a.txt", "1001");
    const second = turn.authorize("/Users/demo/Desktop/b.txt", "1002");

    turn.turnAuthorizations.recordBytes(first, 4_194_304);
    // The second authorization has spent nothing of its own budget.
    expect(turn.turnAuthorizations.get(second)?.spend.totalExpandedBytes).toBe(0);

    const derived = turn.derive(second);
    expect(derived.ok).toBe(false);
    expect(!derived.ok && derived.reason).toBe("budget-exhausted");
  });

  it("refuses redemption on the turn cap, leaving the nonce unconsumed", () => {
    const turn = makeTurn({ turnTotalByteCap: 4_194_304, perAuthorizationBytes: 4_194_304 });
    const first = turn.authorize("/Users/demo/Desktop/a.txt", "1001");
    const second = turn.authorize("/Users/demo/Desktop/b.txt", "1002");

    // Mint before the cap is reached, so the refusal has to happen at redemption.
    const derived = turn.derive(second);
    expect(derived.ok).toBe(true);
    turn.turnAuthorizations.recordBytes(first, 4_194_304);

    const reservation = turn.turnAuthorizations.reserve({
      authorizationId: second,
      operation: "fs.read",
      nowMs: NOW,
      clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
    });
    expect(reservation.ok).toBe(false);
    expect(!reservation.ok && reservation.reason).toBe("budget-turn-bytes-exhausted");
    // No budget was taken from the second authorization either.
    expect(turn.turnAuthorizations.get(second)?.spend.calls).toBe(0);
  });

  it("chunking cannot walk past the turn cap", () => {
    // Four 1 MiB chunks fit each authorization but exceed the 3 MiB turn cap.
    const turn = makeTurn({ turnTotalByteCap: 3_145_728, perAuthorizationBytes: 4_194_304 });
    const ids = [
      turn.authorize("/Users/demo/Desktop/a.txt", "1001"),
      turn.authorize("/Users/demo/Desktop/b.txt", "1002"),
    ];

    let delivered = 0;
    for (let chunk = 0; chunk < 8; chunk += 1) {
      const id = ids[chunk % 2];
      const derived = turn.derive(id);
      if (!derived.ok) {
        break;
      }
      turn.turnAuthorizations.recordBytes(id, 1_048_576);
      delivered += 1_048_576;
    }
    // The cap is enforced against bytes already returned, so the call that
    // reaches it still completes and the next one is refused.
    expect(delivered).toBeLessThanOrEqual(3_145_728 + 1_048_576);
    expect(turn.turnAuthorizations.turnBytesSpent(makeBinding())).toBe(delivered);
    expect(turn.derive(ids[0]).ok).toBe(false);
  });

  it("does not charge one turn's bytes to another turn", () => {
    const turn = makeTurn({ turnTotalByteCap: 5_242_880, perAuthorizationBytes: 4_194_304 });
    const first = turn.authorize("/Users/demo/Desktop/a.txt", "1001");
    turn.turnAuthorizations.recordBytes(first, 5_242_880);

    expect(turn.turnAuthorizations.turnBytesSpent(makeBinding())).toBe(5_242_880);
    expect(turn.turnAuthorizations.turnBytesSpent(makeBinding({ turnId: "turn-2" }))).toBe(0);
    expect(turn.turnAuthorizations.turnBytesSpent(makeBinding({ agentId: "other-bot" }))).toBe(0);
  });

  it("defaults to the design's 10 MiB cap when none is supplied", () => {
    expect(LOCAL_FILES_LIMITS.maxTurnTotalBytes).toBe(10 * 1024 * 1024);
    const store = new TurnAuthorizationStore();
    const signingKey = generateCapabilitySigningKey();
    const issued = issueTurnAuthorization({
      binding: makeBinding(),
      canonicalPath: "/Users/demo/Desktop/a.txt",
      fileId: FILE_ID,
      targetKind: "file",
      operations: ["fs.read"],
      grantSource: "user-directed",
      budget: { maxCalls: 8, maxEntriesRead: 8, maxTotalExpandedBytes: 64 * 1024 * 1024 },
      signingKey,
      store,
      nowMs: NOW,
      expiresAtMs: NOW + 120_000,
    });
    if (!issued.ok) {
      throw new Error(`fixture failed: ${issued.reason}`);
    }
    const id = issued.claims.authorizationId;

    store.recordBytes(id, 10 * 1024 * 1024);
    expect(store.remaining(id)?.totalExpandedBytes).toBe(0);
    expect(
      store.reserve({
        authorizationId: id,
        operation: "fs.read",
        nowMs: NOW,
        clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
      }).ok,
    ).toBe(false);
  });
});

describe("redemption: transaction ordering", () => {
  it("verifies before writing anything", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    const before = h.turnAuthorizations.remaining(h.authorization.claims.authorizationId);
    const verified = verifyRedemption(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(verified.ok).toBe(true);

    // verifyRedemption is pure: no budget taken, no nonce recorded.
    expect(h.turnAuthorizations.remaining(h.authorization.claims.authorizationId)).toEqual(before);
    expect(h.nonces.size()).toBe(0);
  });

  it("does not decrement budget when the nonce was already consumed", () => {
    const h = makeHarness();
    const derived = h.derive("archive.list");

    redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    const afterFirst = h.turnAuthorizations.remaining(h.authorization.claims.authorizationId);

    redeemInvocationCapability(
      { capability: derived.signed, connection: h.connection, operation: "archive.list" },
      h.deps,
      NOW,
    );
    expect(h.turnAuthorizations.remaining(h.authorization.claims.authorizationId)).toEqual(
      afterFirst,
    );
  });
});

describe("keyset: revocation and fail-closed behaviour (9.6 cases 5 and 15)", () => {
  function nodeKeysetHarness() {
    const trustRoot = generateCapabilitySigningKey("root");
    const signingKey = generateCapabilitySigningKey();
    const keyset = new NodeCapabilityKeyset();
    keyset.pinTrustRoot({
      keyId: trustRoot.keyId,
      publicKey: verificationKeyFor(trustRoot).publicKey,
    });
    const doc = signKeysetDocument({
      trustRoot,
      keys: [verificationKeyFor(signingKey)],
      issuedAtMs: NOW,
      expiresAtMs: NOW + 600_000,
    });
    expect(keyset.applyKeysetUpdate(doc).ok).toBe(true);
    return { trustRoot, signingKey, keyset };
  }

  it("rejects a token signed with a revoked keyId without contacting redemption", () => {
    const { trustRoot, signingKey, keyset } = nodeKeysetHarness();
    const binding = makeBinding();
    const signed = signCapability(
      {
        kind: "invocation",
        capabilityId: "ic_1",
        authorizationId: "ta_1",
        binding,
        canonicalPath: "/Users/demo/Desktop/pack.zip",
        fileId: FILE_ID,
        targetKind: "file",
        scope: "exact",
        operation: "archive.list",
        useCount: 1,
        nonce: "nonce-1",
        issuedAtMs: NOW,
        expiresAtMs: NOW + 30_000,
      },
      signingKey,
    );

    expect(verifyCapability(signed, { keyset, nowMs: NOW, expectedKind: "invocation" }).ok).toBe(
      true,
    );

    // Revoke by publishing a keyset that no longer contains the keyId.
    const rotated = signKeysetDocument({
      trustRoot,
      keys: [],
      issuedAtMs: NOW + 1,
      expiresAtMs: NOW + 600_000,
    });
    expect(keyset.applyKeysetUpdate(rotated).ok).toBe(true);

    const after = verifyCapability(signed, { keyset, nowMs: NOW, expectedKind: "invocation" });
    expect(after.ok).toBe(false);
    expect(!after.ok && after.reason).toBe("unknown-key-id");
  });

  it("fails closed when the keyset is expired and cannot be refreshed", () => {
    const { signingKey, keyset } = nodeKeysetHarness();
    const resolved = keyset.resolveVerificationKey(signingKey.keyId, NOW + 600_001);
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.reason).toBe("keyset-expired");
  });

  it("never resolves an unknown keyId, and does not accept a caller-supplied key", () => {
    const { keyset } = nodeKeysetHarness();
    const resolved = keyset.resolveVerificationKey("cap-does-not-exist", NOW);
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.reason).toBe("unknown-key-id");
    // The resolver interface takes only a keyId: there is no parameter through
    // which a caller could inject a public key.
    expect(keyset.resolveVerificationKey.length).toBe(2);
  });

  it("refuses a keyset update that is not signed by the pinned trust root", () => {
    const { keyset, signingKey } = nodeKeysetHarness();
    const impostor = generateCapabilitySigningKey("root");
    const forged = signKeysetDocument({
      trustRoot: impostor,
      keys: [verificationKeyFor(signingKey)],
      issuedAtMs: NOW + 10,
      expiresAtMs: NOW + 600_000,
    });
    const res = keyset.applyKeysetUpdate(forged);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("trust-root-mismatch");
  });

  it("refuses a rolled-back keyset document", () => {
    const { trustRoot, keyset } = nodeKeysetHarness();
    const stale = signKeysetDocument({
      trustRoot,
      keys: [],
      issuedAtMs: NOW - 1,
      expiresAtMs: NOW + 600_000,
    });
    const res = keyset.applyKeysetUpdate(stale);
    expect(!res.ok && res.reason).toBe("rollback");
  });

  it("refuses a keyset pushed over an unauthenticated channel", () => {
    const { keyset } = nodeKeysetHarness();
    const res = keyset.applyKeysetOverAuthenticatedConnection("{}", {
      authenticatedDeviceConnection: false,
    });
    expect(!res.ok && res.reason).toBe("unprotected-channel");
  });

  it("requires a pinned trust root before any keyset is accepted", () => {
    const unpinned = new NodeCapabilityKeyset();
    const trustRoot = generateCapabilitySigningKey("root");
    const doc = signKeysetDocument({
      trustRoot,
      keys: [],
      issuedAtMs: NOW,
      expiresAtMs: NOW + 1000,
    });
    const res = unpinned.applyKeysetUpdate(doc);
    expect(!res.ok && res.reason).toBe("no-trust-root");
    expect(unpinned.resolveVerificationKey("any", NOW).ok).toBe(false);
  });

  it("refuses to re-pin a different trust root", () => {
    const { keyset } = nodeKeysetHarness();
    const other = generateCapabilitySigningKey("root");
    const res = keyset.pinTrustRoot({
      keyId: other.keyId,
      publicKey: verificationKeyFor(other).publicKey,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("already-pinned");
  });
});
