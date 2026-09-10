import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { useLanguage } from '../i18n/LanguageContext';
import type { Language } from '../i18n/translations';
import { useAppColors } from '../theme/useAppColors';
import { ui, type TypeToken, type TypeVariant } from '../theme/ui';

type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: string;
};

export const getFontFamily = (language: Language, weight: TypeToken['weight']) =>
  language === 'bn'
    ? weight === '400'
      ? 'NotoSansBengali'
      : 'NotoSansBengali-SemiBold'
    : undefined;

export const AppText = ({ variant = 'body', color, style, ...rest }: AppTextProps) => {
  const { language } = useLanguage();
  const { colors } = useAppColors();
  const token = ui.type[variant];
  const isBengali = language === 'bn';

  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: getFontFamily(language, token.weight),
          fontWeight: isBengali ? undefined : token.weight,
          fontSize: token.size,
          lineHeight: token.lineHeight,
          color: color ?? colors.text,
        },
        style,
      ]}
    />
  );
};
