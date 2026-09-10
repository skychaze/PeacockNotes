import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TextInput } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { getFontFamily } from './AppText';
import { GlassSurface } from './GlassSurface';
import { IconButton } from './IconButton';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppColors } from '../theme/useAppColors';
import { ui } from '../theme/ui';

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
};

export const SearchBar = ({ value, onChangeText, placeholder, style }: SearchBarProps) => {
  const { colors } = useAppColors();
  const { language } = useLanguage();

  return (
    <GlassSurface
      radius={ui.radius.pill}
      fallbackColor={colors.surfaceVariant}
      style={style}
      contentStyle={{
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: ui.space.lg,
        paddingRight: ui.space.xs,
        gap: ui.space.sm,
      }}
    >
      <MaterialCommunityIcons name="magnify" size={22} color={colors.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={{
          flex: 1,
          color: colors.text,
          fontFamily: getFontFamily(language, '400'),
          fontSize: ui.type.body.size,
          paddingVertical: 0,
        }}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <IconButton icon="close" size={18} onPress={() => onChangeText('')} />
      ) : null}
    </GlassSurface>
  );
};
