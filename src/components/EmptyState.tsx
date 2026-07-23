import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import { useAppColors } from '../theme/useAppColors';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';

type EmptyStateProps = {
  iconName: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
};

export const EmptyState = ({ iconName, title, subtitle }: EmptyStateProps) => {
  const { colors } = useAppColors();
  const iconColor = getContrastColor(colors.card, colors.text, '#FFFFFF');

  return (
    <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: ui.space.xl,
        }}
      >
      <View
        style={{
          width: 66,
          height: 66,
          borderRadius: 33,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: ui.space.md,
        }}
      >
        <MaterialCommunityIcons
          name={iconName}
          size={30}
          color={iconColor}
        />
      </View>
      <Text
        style={{
          color: colors.text,
          fontFamily: 'NotoSansBengali',
          fontSize: ui.font.xl,
          textAlign: 'center',
          lineHeight: 24,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          marginTop: ui.space.xs,
          color: colors.textSecondary,
          fontFamily: 'NotoSansBengali',
          fontSize: ui.font.md,
          lineHeight: 22,
          textAlign: 'center',
        }}
      >
        {subtitle}
      </Text>
    </View>
  );
};
