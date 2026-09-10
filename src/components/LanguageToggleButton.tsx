import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppColors } from '../theme/useAppColors';

export const LanguageToggleButton = () => {
  const { colors } = useAppColors();
  const { t, toggleLanguage } = useLanguage();

  return (
    <PressableScale
      onPress={toggleLanguage}
      accessibilityRole="button"
      accessibilityLabel={t('lang.toggleShort')}
      style={{
        height: 36,
        borderRadius: 999,
        paddingHorizontal: 12,
        backgroundColor: colors.surfaceVariant,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <MaterialCommunityIcons name="translate" size={18} color={colors.text} />
      <AppText variant="caption">{t('lang.toggleShort')}</AppText>
    </PressableScale>
  );
};
