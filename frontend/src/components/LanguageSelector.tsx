import { useState } from "react";
import { useI18n } from "../i18n/context";
import type { Language } from "../i18n/translations";

interface LanguageOption {
  code: Language;
  name: string;
  flag: string;
}

const languages: LanguageOption[] = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
];

export function LanguageSelector() {
  const { language, setLanguage, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const currentLanguage = languages.find((lang) => lang.code === language) || languages[0];

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-50">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-[#433657] bg-[#130f22] px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-[#d7c5f4] shadow-lg transition hover:bg-[#3b2f4f] hover:text-[#0b0913]"
        title={t.selectLanguage}
      >
        <span className="text-base sm:text-lg">{currentLanguage.flag}</span>
        <span className="hidden sm:inline">{currentLanguage.name}</span>
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[45]"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-12 right-0 z-[50] w-44 sm:w-48 rounded-lg border border-[#2f2942] bg-[#130f22] shadow-[0_15px_45px_rgba(8,6,15,0.55)]">
            <div className="border-b border-[#2f2942] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#f0eaff]">
              {t.selectLanguage}
            </div>
            <div className="py-2">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLanguage(lang.code);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition relative z-[51] ${
                    language === lang.code
                      ? "bg-[#2b233c] text-[#f0eaff]"
                      : "text-[#d7c5f4] hover:bg-[#1a1529] hover:text-[#f0eaff]"
                  }`}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span>{lang.name}</span>
                  {language === lang.code && (
                    <span className="ml-auto text-xs">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

