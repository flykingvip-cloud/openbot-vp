import { describe, expect, it } from "vitest";
import {
  filterXTwitterOperationalActionsByGrantedScope,
  isXTwitterOperationalActionAllowedByScope,
  parseUserOperationalIdentityOAuthScopeList,
  xTwitterScopeGrantsPublish,
} from "./user-operational-identity-x-twitter-scope.js";

describe("x-twitter OAuth scope gating", () => {
  it("parses space-separated and comma-separated scopes", () => {
    expect(
      [...parseUserOperationalIdentityOAuthScopeList("tweet.read tweet.write")].toSorted(),
    ).toEqual(["tweet.read", "tweet.write"]);
    expect(
      [...parseUserOperationalIdentityOAuthScopeList("tweet.read,users.read")].toSorted(),
    ).toEqual(["tweet.read", "users.read"]);
  });

  it("requires tweet.write for publish actions", () => {
    expect(xTwitterScopeGrantsPublish("tweet.read users.read offline.access")).toBe(false);
    expect(xTwitterScopeGrantsPublish("tweet.read tweet.write users.read offline.access")).toBe(
      true,
    );
    expect(
      filterXTwitterOperationalActionsByGrantedScope({
        actions: ["publish_post", "reply_comment", "sync_profile_metrics"],
        scope: "tweet.read users.read offline.access",
      }),
    ).toEqual(["sync_profile_metrics"]);
    expect(
      filterXTwitterOperationalActionsByGrantedScope({
        actions: ["publish_post", "reply_comment", "sync_profile_metrics"],
        scope: "tweet.read tweet.write users.read offline.access",
      }),
    ).toEqual(["publish_post", "reply_comment", "sync_profile_metrics"]);
  });

  it("allowAllIfScopeMissing keeps publish for simulated/legacy", () => {
    expect(
      filterXTwitterOperationalActionsByGrantedScope({
        actions: ["publish_post", "sync_profile_metrics"],
        scope: null,
        allowAllIfScopeMissing: true,
      }),
    ).toEqual(["publish_post", "sync_profile_metrics"]);
    expect(
      isXTwitterOperationalActionAllowedByScope({
        action: "publish_post",
        scope: "",
        allowAllIfScopeMissing: false,
      }),
    ).toBe(false);
  });
});
