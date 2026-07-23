import { useColorScheme } from 'react-native';
import { getThemeColors } from './colors';

export const useAppColors = () => {
  const isDark = useColorScheme() === 'dark';
  return {
    isDark,
    colors: getThemeColors(isDark),
  };
};
