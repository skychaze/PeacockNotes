import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '../theme/useAppColors';
import { getContrastColor } from '../theme/contrast';
import { useLanguage } from '../i18n/LanguageContext';

export const LanguageToggleButton = () => {
  const { colors } = useAppColors();
  const { t, toggleLanguage } = useLanguage();
  const bg = colors.primary;
  const textColor = getContrastColor(bg, '#0B1320', '#FFFFFF');

  return (
    <Pressable onPress={toggleLanguage} style={{ marginRight: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: bg,
          borderRadius: 16,
          paddingHorizontal: 8,
          paddingVertical: 6,
        }}
      >
        <MaterialCommunityIcons name="translate" size={15} color={textColor} />
        <Text style={{ color: textColor, fontFamily: 'NotoSansBengali', fontSize: 13 }}>
          {t('lang.toggleShort')}
        </Text>
      </View>
    </Pressable>
  );
};
