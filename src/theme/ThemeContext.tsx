import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { getThemeColors } from './colors';

const THEME_KEY = 'app.theme';

type ThemeContextValue = {
  isDark: boolean;
  colors: ReturnType<typeof getThemeColors>;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const systemIsDark = useColorScheme() === 'dark';
  const [isDark, setIsDark] = useState(systemIsDark);

  useEffect(() => {
    void AsyncStorage.getItem(THEME_KEY).then((stored) => {
      if (stored === 'dark' || stored === 'light') setIsDark(stored === 'dark');
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    isDark,
    colors: getThemeColors(isDark),
    toggleTheme: () => setIsDark((current) => {
      const next = !current;
      void AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      return next;
    }),
  }), [isDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
};
