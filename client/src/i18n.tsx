/**
 * i18n minimaliste (FR/EN) — sans dépendance.
 * Langue initiale : choix persisté, sinon langue du navigateur.
 * Le <html lang> suit la langue active (SEO/accessibilité).
 */

import { createContext, useContext, useEffect, useState } from 'react';

export type Lang = 'fr' | 'en';

const STORAGE_KEY = 'launchforge_lang';

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'fr' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'fr',
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  };

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

/** Sélecteur FR | EN (pages publiques) */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <span className={`lang-switch ${className}`} role="group" aria-label="Language">
      {(['fr', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? 'on' : ''}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
