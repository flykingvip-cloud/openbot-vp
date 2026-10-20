import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadLazyLocaleTranslation,
  resolveNavigatorLocale,
} from "./registry.ts";
import type { Locale, TranslationMap } from "./types.ts";

type Subscriber = (locale: Locale) => void;
const LOCALE_STORAGE_KEY = "openbot.i18n.locale";
const LEGACY_LOCALE_STORAGE_KEY = "openclaw.i18n.locale";

export { SUPPORTED_LOCALES, isSupportedLocale };

export class I18nManager {
  private locale: Locale = DEFAULT_LOCALE;
  private translations: Partial<Record<Locale, TranslationMap>> = {};
  private subscribers: Set<Subscriber> = new Set();
  private localeReady: Promise<void>;

  constructor() {
    this.localeReady = this.loadLocale();
  }

  private syncDocumentLanguage(locale: Locale) {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }

  public whenReady(): Promise<void> {
    return this.localeReady;
  }

  private resolveInitialLocale(): Locale {
    const saved =
      typeof localStorage !== "undefined"
        ? (localStorage.getItem(LOCALE_STORAGE_KEY) ??
          localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY))
        : null;
    if (isSupportedLocale(saved)) {
      return saved;
    }
    const navigatorLanguage =
      typeof navigator !== "undefined" && typeof navigator.language === "string"
        ? navigator.language
        : DEFAULT_LOCALE;
    return resolveNavigatorLocale(navigatorLanguage);
  }

  private async loadLocale() {
    const initialLocale = this.resolveInitialLocale();
    // Use the normal locale setter so startup locale loading follows the same
    // translation-loading + notify path as manual locale changes (including en).
    await this.setLocale(initialLocale);
  }

  public getLocale(): Locale {
    return this.locale;
  }

  public async setLocale(locale: Locale) {
    const needsTranslationLoad = !this.translations[locale];
    if (this.locale === locale && !needsTranslationLoad) {
      this.syncDocumentLanguage(locale);
      return;
    }

    if (needsTranslationLoad) {
      try {
        const translation = await loadLazyLocaleTranslation(locale);
        if (!translation) {
          return;
        }
        this.translations[locale] = translation;
      } catch (e) {
        console.error(`Failed to load locale: ${locale}`, e);
        return;
      }
    }

    this.locale = locale;
    this.syncDocumentLanguage(locale);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      localStorage.removeItem(LEGACY_LOCALE_STORAGE_KEY);
    }
    this.notify();

    // Warm English fallback in the background for non-English locales without
    // blocking first paint on the active locale chunk.
    if (locale !== DEFAULT_LOCALE && !this.translations[DEFAULT_LOCALE]) {
      void loadLazyLocaleTranslation(DEFAULT_LOCALE)
        .then((translation) => {
          if (translation) {
            this.translations[DEFAULT_LOCALE] = translation;
          }
        })
        .catch(() => {
          /* ignore fallback warm failures */
        });
    }
  }

  public registerTranslation(locale: Locale, map: TranslationMap) {
    this.translations[locale] = map;
  }

  public subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  private notify() {
    this.subscribers.forEach((sub) => sub(this.locale));
  }

  public t(key: string, params?: Record<string, string | number>): string {
    const keys = key.split(".");
    let value: unknown = this.translations[this.locale] || this.translations[DEFAULT_LOCALE];

    for (const k of keys) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }

    // Fallback to English.
    if (value === undefined && this.locale !== DEFAULT_LOCALE) {
      value = this.translations[DEFAULT_LOCALE];
      for (const k of keys) {
        if (value && typeof value === "object") {
          value = (value as Record<string, unknown>)[k];
        } else {
          value = undefined;
          break;
        }
      }
    }

    if (typeof value !== "string") {
      return key;
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, k) => {
        const param = params[k];
        return param !== undefined && param !== null ? String(param) : `{${k}}`;
      });
    }

    return value;
  }
}

export const i18n = new I18nManager();
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
