import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listUserOperationalIdentityProviderCatalog } from "./user-operational-identity-providers.js";

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, "skills");
const designDocS1 = path.join(repoRoot, "docs/design/oi-intelligent-bind-s0-s1-2026-10-13.md");
const designDocS2 = path.join(repoRoot, "docs/design/oi-intelligent-bind-s2-github-2026-10-13.md");
const designDocXTwitterOAuth = path.join(
  repoRoot,
  "docs/design/oi-x-twitter-oauth-personal-identity-2026-10-14.md",
);
const designDocS3 = path.join(repoRoot, "docs/design/oi-intelligent-bind-s3-social-2026-10-13.md");
const designDocS4 = path.join(
  repoRoot,
  "docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md",
);
const designDocS5 = path.join(
  repoRoot,
  "docs/design/oi-intelligent-bind-s5-live-path-2026-10-13.md",
);
const designDocS6 = path.join(
  repoRoot,
  "docs/design/oi-intelligent-bind-s6-social-verified-live-2026-10-19.md",
);

/** S1-claimed intelligent-bind skills (must exist). */
const S1_SKILLS = [
  "oi-orchestrate-personal-identity",
  "oi-bind-wechat-official",
  "oi-bind-personal-email",
  "oi-grant-owned-bots",
] as const;

const S1_BIND_PROVIDERS = new Set(["wechat-official", "personal-email"]);

/** Manual social_account providers (x-twitter moved to OAuth primary path). */
const SOCIAL_PROVIDERS = [
  "weibo",
  "zhihu",
  "douyin",
  "xiaohongshu",
  "kuaishou",
  "bilibili",
] as const;

const ALL_FORMER_S3_SOCIAL_SKILLS = [...SOCIAL_PROVIDERS, "x-twitter"] as const;

function readSkill(skillId: string): string {
  return fs.readFileSync(path.join(skillsRoot, skillId, "SKILL.md"), "utf8");
}

describe("oi-intelligent-bind S0+S1 contract", () => {
  it("ships design doc and four S1 skills", () => {
    expect(fs.existsSync(designDocS1)).toBe(true);
    for (const skillId of S1_SKILLS) {
      expect(fs.existsSync(path.join(skillsRoot, skillId, "SKILL.md"))).toBe(true);
    }
  });

  it("documents every registrationReady catalog provider without inventing fields", () => {
    const catalog = listUserOperationalIdentityProviderCatalog();
    const ready = catalog.filter((entry) => entry.registrationReady);
    const design = fs.readFileSync(designDocS1, "utf8");

    for (const entry of ready) {
      expect(design).toContain(entry.provider);
    }

    const feishu = catalog.find((entry) => entry.provider === "feishu-personal");
    expect(feishu?.registrationReady).toBe(false);

    for (const entry of ready) {
      if (S1_BIND_PROVIDERS.has(entry.provider)) {
        expect(design).toMatch(new RegExp(`${entry.provider}[\\s\\S]*?是`));
      }
    }
  });

  it("S1 era no longer blocks social skills (S3 owns them)", () => {
    // Historical S1 assertion flipped after S3: social oi-bind-* must exist.
    for (const provider of ALL_FORMER_S3_SOCIAL_SKILLS) {
      expect(fs.existsSync(path.join(skillsRoot, `oi-bind-${provider}`, "SKILL.md"))).toBe(true);
    }
  });

  it("aligns wechat-official skill fields with personal form + gateway bind", () => {
    const skill = readSkill("oi-bind-wechat-official");
    expect(skill).toMatch(/AppID/);
    expect(skill).toMatch(/AppSecret/);
    expect(skill).toMatch(/显示名称|displayName/);
    expect(skill).toMatch(/credentials\.bind/);
    expect(skill).toMatch(/user-operational-identity\.credentials\.bind/);
    expect(skill).toMatch(/不要.*Token|不要收 Token|不要创建或向用户要 Token/);
    expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity|禁止.*直接改/);
    expect(skill).toMatch(/打进聊天|聊天中无密钥/);
    expect(skill).toMatch(/AppSecret/);
    expect(skill).toMatch(/投影/);
    expect(skill).toMatch(/wechat-official-credential/);
    expect(skill).toMatch(/personal/);
  });

  it("aligns personal-email skill with form fields and 126/163 rule", () => {
    const skill = readSkill("oi-bind-personal-email");
    expect(skill).toMatch(/发件邮箱|credentialHandleId/);
    expect(skill).toMatch(/SMTP/);
    expect(skill).toMatch(/IMAP/);
    expect(skill).toMatch(/授权码/);
    expect(skill).toMatch(/平台代发|usePlatformSmtp/);
    expect(skill).toMatch(/126/);
    expect(skill).toMatch(/163/);
    expect(skill).toMatch(/credentials\.bind/);
    expect(skill).toMatch(/personal-email\.yaml/);
    expect(skill).toMatch(/personal-email-browser\.yaml/);
    expect(skill).not.toMatch(/直接改配置文件/);
    expect(skill).toMatch(/禁止.*直接改 OI JSON|禁止直接改/);
  });

  it("grant skill is thin grants.upsert wrapper for owned bots", () => {
    const skill = readSkill("oi-grant-owned-bots");
    expect(skill).toMatch(/grants\.upsert/);
    expect(skill).toMatch(/agentScope/);
    expect(skill).toMatch(/owned/);
    expect(skill).toMatch(/fail-closed|FAIL|确认/);
    expect(skill).toMatch(/不代替 credentials\.bind|不取证、不写凭证/);
    expect(skill).not.toMatch(/调用 gateway.*credentials\.bind/);
  });

  it("orchestrator marks wechat-personal as non-cloud-computer and forbids file edits", () => {
    const skill = readSkill("oi-orchestrate-personal-identity");
    expect(skill).toMatch(/非云电脑/);
    // S4: oi-bind-wechat-personal wraps worker-setup; keep both names for delegation honesty.
    expect(skill).toMatch(/oi-bind-wechat-personal/);
    expect(skill).toMatch(/wechat-personal-worker-setup/);
    expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity/);
    expect(skill).toMatch(/oi-bind-wechat-official/);
    expect(skill).toMatch(/oi-bind-personal-email/);
    expect(skill).toMatch(/oi-grant-owned-bots/);
    expect(skill).not.toMatch(/直接改配置文件当作产品路径/);
  });

  it("design doc forbids direct JSON edits as product path", () => {
    const design = fs.readFileSync(designDocS1, "utf8");
    expect(design).toMatch(/禁止.*直接改|必须经 gateway OI API/);
    expect(design).toMatch(/credentials\.bind/);
    expect(design).toMatch(/grants\.upsert/);
    expect(design).toMatch(/非云电脑/);
  });
});

describe("oi-intelligent-bind S2 github-personal contract", () => {
  it("ships S2 design doc and oi-bind-github-personal skill", () => {
    expect(fs.existsSync(designDocS2)).toBe(true);
    expect(fs.existsSync(path.join(skillsRoot, "oi-bind-github-personal", "SKILL.md"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(skillsRoot, "oi-bind-github-personal", "references", "oauth-path.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(skillsRoot, "oi-bind-github-personal", "references", "writeback-and-bans.md"),
      ),
    ).toBe(true);
  });

  it("catalog github-personal is registrationReady oauth", () => {
    const catalog = listUserOperationalIdentityProviderCatalog();
    const github = catalog.find((entry) => entry.provider === "github-personal");
    expect(github).toBeTruthy();
    expect(github?.registrationReady).toBe(true);
    expect(github?.authMode).toBe("oauth");
    expect(github?.manualKind).toBeNull();
    expect(github?.operationalActions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["create_issue", "create_pull_request", "comment"]),
    );
  });

  it("orchestrator catalog-map points github-personal at oi-bind-github-personal", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    expect(map).toMatch(/github-personal[\s\S]*?oi-bind-github-personal/);
    expect(map).not.toMatch(/github-personal[\s\S]*?（S2）oi-bind-github-personal/);
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(orch).toMatch(/oi-bind-github-personal/);
  });

  it("github skill aligns oauth fields and bans credentials.bind / JSON / projection", () => {
    const skill = readSkill("oi-bind-github-personal");
    expect(skill).toMatch(/显示名称|displayName/);
    expect(skill).toMatch(/GitHub 用户名|可留空/);
    expect(skill).toMatch(/oauth\.start/);
    expect(skill).toMatch(/user-operational-identity\.oauth\.start/);
    expect(skill).toMatch(/authorizeUrl|授权页/);
    expect(skill).toMatch(/create_issue/);
    expect(skill).toMatch(/create_pull_request/);
    expect(skill).toMatch(/comment/);
    expect(skill).toMatch(/禁止[\s\S]*credentials\.bind|不要用 credentials\.bind/);
    expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity|禁止.*直接改/);
    expect(skill).toMatch(/投影/);
    expect(skill).toMatch(/access_token|secret store/);
    const design = fs.readFileSync(designDocS2, "utf8");
    expect(design).toMatch(/oauth\.start/);
    expect(design).toMatch(/github-personal/);
    expect(design).toMatch(/禁止.*直接改/);
  });
});

describe("oi-intelligent-bind x-twitter OAuth personal identity contract", () => {
  it("ships design doc and oi-bind-x-twitter oauth skill refs", () => {
    expect(fs.existsSync(designDocXTwitterOAuth)).toBe(true);
    const skillDir = path.join(skillsRoot, "oi-bind-x-twitter");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "field-contract.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "oauth-path.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "writeback-and-bans.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "path-map.md"))).toBe(false);
  });

  it("catalog x-twitter is registrationReady oauth (not social_account)", () => {
    const catalog = listUserOperationalIdentityProviderCatalog();
    const entry = catalog.find((item) => item.provider === "x-twitter");
    expect(entry).toBeTruthy();
    expect(entry?.registrationReady).toBe(true);
    expect(entry?.authMode).toBe("oauth");
    expect(entry?.manualKind).toBeNull();
    expect(entry?.operationalActions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["publish_post", "reply_comment", "sync_profile_metrics"]),
    );
  });

  it("orchestrator catalog-map points x-twitter at oauth skill path", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    expect(map).toMatch(/x-twitter[\s\S]*?oi-bind-x-twitter/);
    expect(map).toMatch(/x-twitter[\s\S]*?oauth\.start/);
    expect(map).not.toMatch(/x-twitter[\s\S]*?credentials\.bind \(social_account\)/);
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(orch).toMatch(/oi-bind-x-twitter/);
  });

  it("x-twitter skill aligns oauth fields and bans credentials.bind / JSON / projection", () => {
    const skill = readSkill("oi-bind-x-twitter");
    expect(skill).toMatch(/显示名称|displayName/);
    expect(skill).toMatch(/oauth\.start/);
    expect(skill).toMatch(/user-operational-identity\.oauth\.start/);
    expect(skill).toMatch(/authorizeUrl|授权页/);
    expect(skill).toMatch(/tweet\.write/);
    expect(skill).toMatch(/publish_post/);
    expect(skill).toMatch(/path_unstable:\s*false/);
    expect(skill).toMatch(/verified_live:\s*false/);
    expect(skill).toMatch(/禁止[\s\S]*credentials\.bind|不要用 credentials\.bind/);
    expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity|禁止.*直接改/);
    expect(skill).toMatch(/投影/);
    expect(skill).toMatch(/secret store/);
    const design = fs.readFileSync(designDocXTwitterOAuth, "utf8");
    expect(design).toMatch(/oauth\.start/);
    expect(design).toMatch(/x-twitter/);
    expect(design).toMatch(/tweet\.write/);
    expect(design).toMatch(/禁止.*credentials\.bind|credentials\.bind/);
  });
});

describe("oi-intelligent-bind S3 social_account contract", () => {
  it("ships S3 design doc and six oi-bind social_account skills with path maps", () => {
    expect(fs.existsSync(designDocS3)).toBe(true);
    for (const provider of SOCIAL_PROVIDERS) {
      const skillDir = path.join(skillsRoot, `oi-bind-${provider}`);
      expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "references", "field-contract.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "references", "path-map.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "references", "writeback-and-bans.md"))).toBe(true);
    }
  });

  it("catalog social providers are registrationReady social_account", () => {
    const catalog = listUserOperationalIdentityProviderCatalog();
    for (const provider of SOCIAL_PROVIDERS) {
      const entry = catalog.find((item) => item.provider === provider);
      expect(entry).toBeTruthy();
      expect(entry?.registrationReady).toBe(true);
      expect(entry?.authMode).toBe("manual");
      expect(entry?.manualKind).toBe("social_account");
      expect(entry?.operationalActions.map((a) => a.action)).toEqual(
        expect.arrayContaining(["publish_post", "reply_comment", "sync_profile_metrics"]),
      );
    }
  });

  it("orchestrator catalog-map points each social provider at oi-bind-*", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(map).not.toMatch(/（S3）未实现/);
    for (const provider of SOCIAL_PROVIDERS) {
      expect(map).toMatch(new RegExp(`${provider}[\\s\\S]*?oi-bind-${provider}`));
      expect(orch).toMatch(new RegExp(`oi-bind-${provider}`));
    }
  });

  it("each social skill marks path_unstable and aligns bind fields / bans", () => {
    const design = fs.readFileSync(designDocS3, "utf8");
    expect(design).toMatch(/path_unstable/);
    expect(design).toMatch(/credentials\.bind/);
    expect(design).toMatch(/禁止.*直接改/);
    for (const provider of SOCIAL_PROVIDERS) {
      const skill = readSkill(`oi-bind-${provider}`);
      const pathMap = fs.readFileSync(
        path.join(skillsRoot, `oi-bind-${provider}`, "references", "path-map.md"),
        "utf8",
      );
      expect(skill).toMatch(/path_unstable:\s*true|path_unstable: true/);
      expect(pathMap).toMatch(/path_unstable:\s*true/);
      expect(pathMap).toMatch(/verified_live:\s*false/);
      expect(pathMap).toMatch(/public_docs|UNKNOWN/);
      expect(skill).toMatch(/显示名称|displayName/);
      expect(skill).toMatch(/accountHandle|credentialHandleId/);
      expect(skill).toMatch(/accessToken|appSecret|Cookie|Token|访问凭证|密钥/);
      expect(skill).toMatch(/credentials\.bind/);
      expect(skill).toMatch(/user-operational-identity\.credentials\.bind/);
      expect(skill).toMatch(/social_account/);
      expect(skill).toMatch(/publish_post/);
      expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity|禁止.*直接改/);
      expect(skill).toMatch(/投影/);
      expect(skill).not.toMatch(/verified_live:\s*true/);
    }
  });
});

describe("oi-intelligent-bind S4 wechat-personal contract", () => {
  it("ships S4 design doc and oi-bind-wechat-personal skill with local-channel refs", () => {
    expect(fs.existsSync(designDocS4)).toBe(true);
    const skillDir = path.join(skillsRoot, "oi-bind-wechat-personal");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "field-contract.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "local-channel-map.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "references", "writeback-and-bans.md"))).toBe(true);
  });

  it("catalog wechat-personal is registrationReady qr_channel", () => {
    const catalog = listUserOperationalIdentityProviderCatalog();
    const entry = catalog.find((item) => item.provider === "wechat-personal");
    expect(entry).toBeTruthy();
    expect(entry?.registrationReady).toBe(true);
    expect(entry?.authMode).toBe("qr_channel");
    expect(entry?.manualKind).toBeNull();
    expect(entry?.rolloutTier).toBe("deferred");
    expect(entry?.operationalActions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["probe_status"]),
    );
  });

  it("orchestrator catalog-map points wechat-personal at oi-bind-wechat-personal (non-cloud)", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    expect(map).toMatch(/wechat-personal[\s\S]*?oi-bind-wechat-personal/);
    expect(map).toMatch(/wechat-personal[\s\S]*?非云电脑/);
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(orch).toMatch(/oi-bind-wechat-personal/);
    expect(orch).toMatch(/非云电脑/);
    expect(orch).toMatch(/wechat-personal-worker-setup/);
  });

  it("wechat-personal skill forbids credentials.bind/oauth and asserts local wechat-personal APIs", () => {
    const skill = readSkill("oi-bind-wechat-personal");
    const field = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-wechat-personal", "references", "field-contract.md"),
      "utf8",
    );
    const channel = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-wechat-personal", "references", "local-channel-map.md"),
      "utf8",
    );
    const bans = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-wechat-personal", "references", "writeback-and-bans.md"),
      "utf8",
    );
    const design = fs.readFileSync(designDocS4, "utf8");

    expect(skill).toMatch(/wechat-personal\.status|wechat-personal\.status/);
    expect(skill).toMatch(/qr\.start/);
    expect(skill).toMatch(/qr\.wait/);
    expect(skill).toMatch(/bind-existing/);
    expect(skill).toMatch(/user-operational-identity\.wechat-personal/);
    expect(skill).toMatch(/非云电脑|non_cloud_primary/);
    expect(skill).toMatch(/本机/);
    expect(skill).toMatch(/wechat-personal-worker-setup/);
    expect(skill).toMatch(/禁止[\s\S]*credentials\.bind|禁止.*credentials\.bind/);
    expect(skill).toMatch(/oauth\.start/);
    expect(skill).toMatch(/禁止[\s\S]*openbot-user-operational-identity|禁止.*直接改/);
    expect(skill).toMatch(/投影/);
    expect(skill).toMatch(/wxid/);

    expect(field).toMatch(/qr_channel/);
    expect(field).toMatch(/wechat-personal\.status/);
    expect(channel).toMatch(/non_cloud_primary/);
    expect(channel).toMatch(/本机|loopback/);
    expect(bans).toMatch(/credentials\.bind/);
    expect(bans).toMatch(/oauth\.start/);
    expect(bans).toMatch(/wechat-personal\.status/);
    expect(design).toMatch(/qr_channel/);
    expect(design).toMatch(/non_cloud_primary|非云电脑/);
    expect(design).toMatch(/wechat-personal\.qr\.start|qr\.start/);
    expect(design).toMatch(/禁止.*credentials\.bind|credentials\.bind/);
  });
});

describe("oi-intelligent-bind S5 live-path harden contract", () => {
  it("ships S5 design doc and wechat-official cloud-pc live evidence", () => {
    expect(fs.existsSync(designDocS5)).toBe(true);
    const evidence = path.join(
      skillsRoot,
      "oi-bind-wechat-official",
      "references",
      "cloud-pc-live-evidence.md",
    );
    expect(fs.existsSync(evidence)).toBe(true);
    const body = fs.readFileSync(evidence, "utf8");
    expect(body).toMatch(/verified_live:\s*true/);
    expect(body).toMatch(/2026-10-13/);
    expect(body).toMatch(/SCAN_MP/);
    expect(body).toMatch(/credentials\.bind|BIND/);
    expect(body).toMatch(/IP/);
    expect(body).toMatch(/禁止[\s\S]*AppSecret|AppSecret[\s\S]*禁止|不进聊天/);
    const design = fs.readFileSync(designDocS5, "utf8");
    expect(design).toMatch(/verified_live/);
    expect(design).toMatch(/111001/);
    expect(design).toMatch(/#690|6cc6afe8/);
    expect(design).toMatch(/禁止.*直接改|密钥/);
  });

  it("wechat-official skill marks verified_live and points at cloud-pc evidence", () => {
    const skill = readSkill("oi-bind-wechat-official");
    expect(skill).toMatch(/verified_live:\s*true/);
    expect(skill).toMatch(/path_unstable:\s*false/);
    expect(skill).toMatch(/cloud-pc-live-evidence/);
    expect(skill).toMatch(/credentials\.bind/);
    expect(skill).toMatch(/投影/);
    const consoleMap = fs.readFileSync(
      path.join(skillsRoot, "wechat-official-credential", "references", "console-map.md"),
      "utf8",
    );
    expect(consoleMap).toMatch(/verified_live/);
    expect(consoleMap).toMatch(/cloud-pc-live-evidence/);
  });

  it("weibo path-map records GeeTest/111001 but keeps path_unstable and not verified_live", () => {
    const pathMap = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-weibo", "references", "path-map.md"),
      "utf8",
    );
    // YAML header must stay unstable / not verified (prose may mention future flip criteria).
    const yamlHeader = pathMap.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(yamlHeader).toMatch(/path_unstable:\s*true/);
    expect(yamlHeader).toMatch(/verified_live:\s*false/);
    expect(yamlHeader).not.toMatch(/path_unstable:\s*false/);
    expect(yamlHeader).not.toMatch(/verified_live:\s*true/);
    expect(pathMap).toMatch(/111001/);
    expect(pathMap).toMatch(/[Gg]ee[Tt]est|geetest/);
    expect(pathMap).toMatch(/measured/);
    const skill = readSkill("oi-bind-weibo");
    expect(skill).toMatch(/path_unstable:\s*true|path_unstable: true/);
    expect(skill).toMatch(/111001/);
    expect(skill).not.toMatch(/verified_live:\s*true/);
  });

  it("other social providers stay path_unstable and must not claim verified_live", () => {
    const others = SOCIAL_PROVIDERS.filter((p) => p !== "weibo");
    for (const provider of others) {
      const pathMap = fs.readFileSync(
        path.join(skillsRoot, `oi-bind-${provider}`, "references", "path-map.md"),
        "utf8",
      );
      expect(pathMap).toMatch(/path_unstable:\s*true/);
      expect(pathMap).toMatch(/verified_live:\s*false/);
      expect(pathMap).not.toMatch(/verified_live:\s*true/);
      const skill = readSkill(`oi-bind-${provider}`);
      expect(skill).not.toMatch(/verified_live:\s*true/);
    }
  });

  it("x-twitter oauth-path clears path_unstable but keeps verified_live false", () => {
    const oauthPath = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-x-twitter", "references", "oauth-path.md"),
      "utf8",
    );
    const yamlHeader = oauthPath.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(yamlHeader).toMatch(/path_unstable:\s*false/);
    expect(yamlHeader).toMatch(/verified_live:\s*false/);
    const skill = readSkill("oi-bind-x-twitter");
    expect(skill).not.toMatch(/verified_live:\s*true/);
    expect(skill).toMatch(/path_unstable:\s*false/);
  });

  it("orchestrator default-recommends only verified_live and documents weibo honesty", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(map).toMatch(/verified_live/);
    expect(map).toMatch(/wechat-official[\s\S]*?\*\*true\*\*/);
    expect(map).toMatch(/weibo[\s\S]*?\*\*true\*\*|weibo[\s\S]*?path_unstable/);
    expect(map).toMatch(/默认推荐[\s\S]*verified_live|只推荐 `verified_live/);
    expect(orch).toMatch(/oi-intelligent-bind-s5-live-path/);
    expect(orch).toMatch(/默认推荐[\s\S]*verified_live|verified_live:\s*true/);
    expect(orch).toMatch(/111001|GeeTest|geetest/);
    expect(orch).toMatch(/path_unstable/);
  });
});

describe("oi-intelligent-bind S6 social verified_live honesty contract", () => {
  const S6_SOCIAL_SEVEN = [
    "xiaohongshu",
    "douyin",
    "weibo",
    "bilibili",
    "zhihu",
    "kuaishou",
    "x-twitter",
  ] as const;

  it("ships S6 design doc and live-evidence for all seven social providers", () => {
    expect(fs.existsSync(designDocS6)).toBe(true);
    const design = fs.readFileSync(designDocS6, "utf8");
    expect(design).toMatch(/verified_live/);
    expect(design).toMatch(/2026-10-19/);
    expect(design).toMatch(/Asia\/Shanghai|CST/);
    expect(design).toMatch(/credentials\.bind/);
    expect(design).toMatch(/禁止.*直接改|密钥/);
    expect(design).toMatch(/111001/);
    expect(design).toMatch(/#827|account-computer/);
    for (const provider of S6_SOCIAL_SEVEN) {
      expect(design).toContain(provider);
      const evidence = path.join(
        skillsRoot,
        `oi-bind-${provider}`,
        "references",
        "live-evidence.md",
      );
      expect(fs.existsSync(evidence)).toBe(true);
      const body = fs.readFileSync(evidence, "utf8");
      expect(body).toMatch(/2026-10-19/);
      expect(body).toMatch(/Asia\/Shanghai|live_probe_tz:\s*Asia\/Shanghai/);
      expect(body).toMatch(/verified_live:\s*false/);
      // Must not claim verified_live true in YAML sense for this slice.
      const yamlHeader = body.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
      expect(yamlHeader).toMatch(/verified_live:\s*false/);
      expect(yamlHeader).not.toMatch(/verified_live:\s*true/);
      expect(body).toMatch(/失败|阻断|未达|未执行/);
    }
  });

  it("social_account six stay path_unstable and not verified_live after S6 evidence", () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const pathMap = fs.readFileSync(
        path.join(skillsRoot, `oi-bind-${provider}`, "references", "path-map.md"),
        "utf8",
      );
      const yamlHeader = pathMap.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
      expect(yamlHeader).toMatch(/path_unstable:\s*true/);
      expect(yamlHeader).toMatch(/verified_live:\s*false/);
      expect(yamlHeader).not.toMatch(/verified_live:\s*true/);
      expect(pathMap).toMatch(/live-evidence/);
      const skill = readSkill(`oi-bind-${provider}`);
      expect(skill).toMatch(/live-evidence/);
      expect(skill).not.toMatch(/verified_live:\s*true/);
      expect(skill).toMatch(/path_unstable:\s*true|path_unstable: true/);
    }
  });

  it("weibo keeps GeeTest/111001 measured honesty and S6 live-evidence", () => {
    const pathMap = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-weibo", "references", "path-map.md"),
      "utf8",
    );
    expect(pathMap).toMatch(/111001/);
    expect(pathMap).toMatch(/[Gg]ee[Tt]est|geetest/);
    expect(pathMap).toMatch(/measured/);
    expect(pathMap).toMatch(/live-evidence/);
    const evidence = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-weibo", "references", "live-evidence.md"),
      "utf8",
    );
    expect(evidence).toMatch(/111001/);
    expect(evidence).toMatch(/measured/);
    const yamlHeader = evidence.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(yamlHeader).toMatch(/path_unstable:\s*true/);
    expect(yamlHeader).toMatch(/verified_live:\s*false/);
  });

  it("zhihu live-evidence notes #827 does not equal OI credentials.bind success", () => {
    const evidence = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-zhihu", "references", "live-evidence.md"),
      "utf8",
    );
    expect(evidence).toMatch(/#827|827/);
    expect(evidence).toMatch(/credentials\.bind/);
    expect(evidence).toMatch(/不等于|≠|does not|不等于/);
    const yamlHeader = evidence.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(yamlHeader).toMatch(/verified_live:\s*false/);
    expect(yamlHeader).not.toMatch(/verified_live:\s*true/);
  });

  it("x-twitter keeps path_unstable false and verified_live false with S6 evidence", () => {
    const oauthPath = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-x-twitter", "references", "oauth-path.md"),
      "utf8",
    );
    const yamlHeader = oauthPath.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(yamlHeader).toMatch(/path_unstable:\s*false/);
    expect(yamlHeader).toMatch(/verified_live:\s*false/);
    expect(oauthPath).toMatch(/live-evidence/);
    const evidence = fs.readFileSync(
      path.join(skillsRoot, "oi-bind-x-twitter", "references", "live-evidence.md"),
      "utf8",
    );
    const evYaml = evidence.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
    expect(evYaml).toMatch(/path_unstable:\s*false/);
    expect(evYaml).toMatch(/verified_live:\s*false/);
    expect(evidence).toMatch(/oauth\.start|oauth\.\*/);
    const skill = readSkill("oi-bind-x-twitter");
    expect(skill).toMatch(/live-evidence/);
    expect(skill).not.toMatch(/verified_live:\s*true/);
  });

  it("orchestrator default-recommends only verified_live and documents S6 seven-site honesty", () => {
    const map = fs.readFileSync(
      path.join(skillsRoot, "oi-orchestrate-personal-identity", "references", "catalog-map.md"),
      "utf8",
    );
    const orch = readSkill("oi-orchestrate-personal-identity");
    expect(map).toMatch(/S6|s6/);
    expect(map).toMatch(/默认推荐[\s\S]*verified_live|只推荐 `verified_live/);
    expect(map).toMatch(/0\/7|live-evidence/);
    for (const provider of S6_SOCIAL_SEVEN) {
      expect(map).toMatch(new RegExp(`${provider}[\\s\\S]*?oi-bind-${provider}`));
      // catalog must not mark these seven as verified_live true
      const row = map.split("\n").find((line) => line.includes(`| ${provider} `));
      expect(row).toBeTruthy();
      expect(row).not.toMatch(/\|\s*\*\*true\*\*\s*\|?\s*$/);
      // last column should be false for social seven
      expect(row).toMatch(/false/);
    }
    expect(orch).toMatch(/oi-intelligent-bind-s6-social-verified-live/);
    expect(orch).toMatch(/默认推荐[\s\S]*verified_live|verified_live:\s*true/);
    expect(orch).toMatch(/live-evidence|S6/);
    expect(orch).toMatch(/path_unstable/);
    expect(orch).toMatch(/111001|GeeTest|geetest/);
  });

  it("forbids empty verified_live flips: no S6 social skill YAML claims verified_live true", () => {
    for (const provider of S6_SOCIAL_SEVEN) {
      const skill = readSkill(`oi-bind-${provider}`);
      expect(skill).not.toMatch(/verified_live:\s*true/);
      const refName = provider === "x-twitter" ? "oauth-path.md" : "path-map.md";
      const ref = fs.readFileSync(
        path.join(skillsRoot, `oi-bind-${provider}`, "references", refName),
        "utf8",
      );
      const yamlHeader = ref.match(/```yaml([\s\S]*?)```/)?.[1] ?? "";
      expect(yamlHeader).not.toMatch(/verified_live:\s*true/);
    }
  });
});
