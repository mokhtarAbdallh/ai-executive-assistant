import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: "ar", // Arabic is default per SPEC & ADR-007
  fallbackLng: "ar",
  interpolation: {
    escapeValue: false,
  },
});

export function setLanguage(lang: "ar" | "en"): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export default i18n;
