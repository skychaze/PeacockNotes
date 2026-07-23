export type ThemeColors = {
  background: string;
  card: string;
  text: string;
  textSecondary: string;
  primary: string;
  secondary: string;
  accent: string;
  border: string;
  error: string;
};

export const PeacockTheme: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F0F5F5',
    card: '#FFFFFF',
    text: '#1C3144',
    textSecondary: '#596F78',
    primary: '#0A5C5A',
    secondary: '#D7B377',
    accent: '#2D6A8E',
    border: '#D1E0E0',
    error: '#D95D39',
  },
  dark: {
    background: '#0D1B2A',
    card: '#1B263B',
    text: '#E0E1DD',
    textSecondary: '#A9B4C2',
    primary: '#1FA39A',
    secondary: '#FFD166',
    accent: '#4F86C6',
    border: '#2C3E50',
    error: '#EF476F',
  }
};

export const getThemeColors = (isDark: boolean) =>
  isDark ? PeacockTheme.dark : PeacockTheme.light;
