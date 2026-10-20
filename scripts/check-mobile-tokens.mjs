#!/usr/bin/env node
/**
 * Fail if design/mobile-tokens.json hex (and a few layout numbers)
 * drift from Android MobileUiTokens.kt and iOS OpenBotMobileTokens.swift.
 * Also fails if the iOS Manrope copies are not byte-identical to Android,
 * or if iOS text styles stop using those PostScript names.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(fs.readFileSync(path.join(root, "design/mobile-tokens.json"), "utf8"));
const kt = fs.readFileSync(
  path.join(root, "apps/android/app/src/main/java/ai/openbot/app/ui/MobileUiTokens.kt"),
  "utf8",
);
const swift = fs.readFileSync(
  path.join(root, "apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift"),
  "utf8",
);
const tabs = fs.readFileSync(
  path.join(root, "apps/android/app/src/main/java/ai/openbot/app/ui/PostOnboardingTabs.kt"),
  "utf8",
);

const errors = [];

function hexSet(re, text) {
  return new Set([...text.matchAll(re)].map((m) => m[1].toUpperCase()));
}

function collectJsonHex(node, into) {
  if (typeof node === "string" && /^#[0-9A-Fa-f]{6}$/.test(node)) {
    into.add(node.slice(1).toUpperCase());
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsonHex(item, into);
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      collectJsonHex(value, into);
    }
  }
}

const jsonHex = new Set();
collectJsonHex(tokens.palette, jsonHex);
collectJsonHex(tokens.gradient, jsonHex);

const ktHex = hexSet(/Color\(0xFF([0-9A-Fa-f]{6})\)/g, kt);
const swiftHex = hexSet(/Color\(hex:\s*0x([0-9A-Fa-f]{6})\)/g, swift);

function diffSet(label, left, right) {
  const onlyLeft = [...left].filter((h) => !right.has(h)).toSorted((a, b) => a.localeCompare(b));
  const onlyRight = [...right].filter((h) => !left.has(h)).toSorted((a, b) => a.localeCompare(b));
  if (onlyLeft.length || onlyRight.length) {
    errors.push(
      `${label}: only in JSON/left [${onlyLeft.join(", ")}] only in source/right [${onlyRight.join(", ")}]`,
    );
  }
}

diffSet("palette+gradient vs Android MobileUiTokens.kt", jsonHex, ktHex);
diffSet("palette+gradient vs iOS OpenBotMobileTokens.swift", jsonHex, swiftHex);

function mustInclude(label, text, needle) {
  if (!text.includes(needle)) {
    errors.push(`${label} missing ${JSON.stringify(needle)}`);
  }
}

if (tokens.layout?.pageGutter !== 20 || tokens.layout?.pageVertical !== 16) {
  errors.push("design/mobile-tokens.json layout gutter/vertical must stay 20/16");
}
mustInclude("Android tokens", kt, "mobilePageGutter = 20.dp");
mustInclude("Android tokens", kt, "mobilePageVertical = 16.dp");
mustInclude("iOS tokens", swift, "pageGutter: CGFloat = 20");
mustInclude("iOS tokens", swift, "pageVertical: CGFloat = 16");

const tab = tokens.tabBar ?? {};
if (tab.cornerRadius !== 24 || tab.itemCornerRadius !== 16 || tab.minItemHeight !== 58) {
  errors.push("tabBar corner/item/minHeight must stay 24/16/58");
}
if (tab.backgroundOpacity !== 0.97) {
  errors.push("tabBar.backgroundOpacity must stay 0.97");
}
mustInclude("iOS tokens", swift, "tabBarCornerRadius: CGFloat = 24");
mustInclude("iOS tokens", swift, "tabItemCornerRadius: CGFloat = 16");
mustInclude("iOS tokens", swift, "tabBarMinItemHeight: CGFloat = 58");
mustInclude("iOS tokens", swift, "Color.white.opacity(0.97)");
mustInclude("Android tabs", tabs, "Color.White.copy(alpha = 0.97f)");
mustInclude("Android tabs", tabs, "RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)");
mustInclude("Android tabs", tabs, "heightIn(min = 58.dp)");
mustInclude("Android tabs", tabs, "RoundedCornerShape(16.dp)");

const weightToSwift = { 500: "medium", 600: "semibold", 700: "bold" };
for (const spec of Object.values(tokens.type ?? {})) {
  const iosOnly =
    Array.isArray(spec.platforms) && spec.platforms.length === 1 && spec.platforms[0] === "ios";
  if (!iosOnly) {
    mustInclude("Android tokens", kt, `fontSize = ${spec.size}.sp`);
    if (spec.lineHeight != null) {
      mustInclude("Android tokens", kt, `lineHeight = ${spec.lineHeight}.sp`);
    }
    if (spec.letterSpacing != null) {
      const ls = Number.isInteger(spec.letterSpacing)
        ? `${spec.letterSpacing}.0`
        : String(spec.letterSpacing);
      const literal = spec.letterSpacing < 0 ? `(${ls}).sp` : `${ls}.sp`;
      mustInclude("Android tokens", kt, `letterSpacing = ${literal}`);
    }
  } else {
    mustInclude("iOS tokens", swift, "func moduleTitle()");
  }
  mustInclude("iOS tokens", swift, `size: ${spec.size}`);
  const swiftWeight = weightToSwift[spec.weight];
  if (swiftWeight) {
    mustInclude("iOS tokens", swift, swiftWeight);
  }
}

const paletteNames = {
  surface: ["mobileSurface", "surface"],
  surfaceStrong: ["mobileSurfaceStrong", "surfaceStrong"],
  border: ["mobileBorder", "border"],
  borderStrong: ["mobileBorderStrong", "borderStrong"],
  text: ["mobileText", "text"],
  textSecondary: ["mobileTextSecondary", "textSecondary"],
  textTertiary: ["mobileTextTertiary", "textTertiary"],
  accent: ["mobileAccent", "accent"],
  accentSoft: ["mobileAccentSoft", "accentSoft"],
  success: ["mobileSuccess", "success"],
  successSoft: ["mobileSuccessSoft", "successSoft"],
  warning: ["mobileWarning", "warning"],
  warningSoft: ["mobileWarningSoft", "warningSoft"],
  danger: ["mobileDanger", "danger"],
  dangerSoft: ["mobileDangerSoft", "dangerSoft"],
  codeBg: ["mobileCodeBg", "codeBg"],
  codeText: ["mobileCodeText", "codeText"],
};

for (const [key, [androidSymbol, iosSymbol]] of Object.entries(paletteNames)) {
  const hex = String(tokens.palette?.[key] ?? "")
    .replace("#", "")
    .toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) {
    errors.push(`palette.${key} is not #RRGGBB`);
    continue;
  }
  mustInclude("Android tokens", kt, `${androidSymbol} = Color(0xFF${hex})`);
  mustInclude("iOS tokens", swift, `${iosSymbol} = Color(hex: 0x${hex})`);
}

for (const key of ["backgroundTop", "backgroundMid", "backgroundBottom"]) {
  const hex = String(tokens.palette?.[key] ?? "")
    .replace("#", "")
    .toUpperCase();
  mustInclude("iOS tokens", swift, `${key} = Color(hex: 0x${hex})`);
}
const gradientStops = (tokens.gradient?.background?.stops ?? []).map((stop) =>
  String(stop).replace("#", "").toUpperCase(),
);
if (gradientStops.length === 3) {
  mustInclude(
    "Android tokens",
    kt,
    `Color(0xFF${gradientStops[0]}),\n      Color(0xFF${gradientStops[1]}),\n      Color(0xFF${gradientStops[2]}),`,
  );
} else {
  errors.push("gradient.background.stops must be three hex colors");
}

const font = tokens.font ?? {};
if (font.family !== "Manrope") {
  errors.push(`font.family must stay Manrope, got ${JSON.stringify(font.family)}`);
}
const fontFiles = font.files ?? {};
const expectedWeights = ["400", "500", "600", "700"];
for (const weight of expectedWeights) {
  if (!fontFiles[weight]) {
    errors.push(`font.files missing weight ${weight}`);
  }
}
const androidDir = font.androidDir;
const iosDir = font.iosDir;
if (androidDir !== "apps/android/app/src/main/res/font" || iosDir !== "apps/ios/Sources/Fonts") {
  errors.push(
    "font.androidDir / font.iosDir must stay the Android res/font source and the iOS Sources/Fonts copy",
  );
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const plist = fs.readFileSync(path.join(root, "apps/ios/Sources/Info.plist"), "utf8");
const projectYml = fs.readFileSync(path.join(root, "apps/ios/project.yml"), "utf8");
if (swift.includes(".system(size:")) {
  errors.push("iOS MobileUI text styles still use .system(size:) instead of Manrope");
}
mustInclude("iOS tokens", swift, "Font.custom(self.manropePostScriptName(weight), size: size)");

for (const weight of expectedWeights) {
  const spec = fontFiles[weight];
  if (!spec) {
    continue;
  }
  const fileName = spec.file;
  const postScript = spec.postScript;
  if (!fileName || !postScript) {
    errors.push(`font.files.${weight} needs file and postScript`);
    continue;
  }
  mustInclude("iOS tokens", swift, postScript);
  mustInclude("Android tokens", kt, `R.font.${fileName.replace(/\.ttf$/, "")}`);
  mustInclude("iOS Info.plist", plist, `<string>${fileName}</string>`);
  mustInclude("iOS project.yml", projectYml, `- ${fileName}`);
  const androidFile = path.join(root, androidDir, fileName);
  const iosFile = path.join(root, iosDir, fileName);
  if (!fs.existsSync(androidFile) || !fs.existsSync(iosFile)) {
    errors.push(`missing Manrope file for weight ${weight}: ${fileName}`);
    continue;
  }
  const androidHash = sha256(androidFile);
  const iosHash = sha256(iosFile);
  if (androidHash !== iosHash) {
    errors.push(`Manrope ${fileName} iOS copy != Android source (${iosHash} != ${androidHash})`);
  }
}

if (errors.length) {
  console.error("check-mobile-tokens: FAIL");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log(
  `check-mobile-tokens: ok (${jsonHex.size} hex colors match Android MobileUiTokens.kt and iOS OpenBotMobileTokens.swift; Manrope faces match)`,
);
