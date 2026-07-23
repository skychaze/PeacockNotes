import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { translations, type Language } from './translations';

type LanguageContextType = {
  language: Language;
  isLanguageReady: boolean;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LANGUAGE_STORAGE_KEY = 'peacock_notes.language';

const LanguageContext = createContext<LanguageContextType | null>(null);

const applyParams = (text: string, params?: Record<string, string | number>) => {
  if (!params) {
    return text;
  }

  return Object.entries(params).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value));
  }, text);
};

export const LanguageProvider = ({ children }: PropsWithChildren) => {
  const [language, setLanguageState] = useState<Language>('bn');
  const [isLanguageReady, setIsLanguageReady] = useState(false);

  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (savedLanguage === 'bn' || savedLanguage === 'en') {
          setLanguageState(savedLanguage);
        }
      } catch (error) {
        console.warn('Failed to load language preference:', error);
      } finally {
        setIsLanguageReady(true);
      }
    };

    void loadLanguage();
  }, []);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage).catch((error) => {
      console.warn('Failed to persist language preference:', error);
    });
  };

  const toggleLanguage = () => {
    setLanguage(language === 'bn' ? 'en' : 'bn');
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    const table = translations[language];
    const fallback = translations.en;
    const raw = table[key] ?? fallback[key] ?? key;
    return applyParams(raw, params);
  };

  const value = useMemo(
    () => ({
      language,
      isLanguageReady,
      setLanguage,
      toggleLanguage,
      t,
    }),
    [isLanguageReady, language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
