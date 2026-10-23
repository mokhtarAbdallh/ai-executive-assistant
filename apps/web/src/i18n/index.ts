import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

const LANGUAGE_KEY = "dawwen_lang";

export type Language = "ar" | "en";

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "ar";
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

/** Keep <html lang dir> in sync with the language, including on first paint. */
function syncDocument(lang: string): void {
  if (typeof document === "undefined") return;
  const resolved: Language = lang.startsWith("en") ? "en" : "ar";
  document.documentElement.lang = resolved;
  document.documentElement.dir = resolved === "ar" ? "rtl" : "ltr";
}

const initialLanguage = readStoredLanguage();
syncDocument(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: "ar",
  supportedLngs: ["ar", "en"],
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lang) => syncDocument(lang));

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  syncDocument(lang);
  try {
    window.localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Private mode: the language still applies for this session.
  }
}

export function toggleLanguage(): void {
  setLanguage(i18n.language.startsWith("en") ? "ar" : "en");
}

export default i18n;
