import type { PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAppColors } from '../theme/useAppColors';
import { getContrastColor } from '../theme/contrast';
import { ui } from '../theme/ui';

type PrimaryButtonProps = PropsWithChildren<{
  onPress: () => void;
  disabled?: boolean;
}>;

export const PrimaryButton = ({
  onPress,
  disabled = false,
  children,
}: PrimaryButtonProps) => {
  const { colors } = useAppColors();
  const buttonBackground = disabled ? colors.border : colors.primary;
  const buttonTextColor = getContrastColor(buttonBackground, colors.text, '#FFFFFF');

  return (
    <Pressable onPress={onPress} disabled={disabled}>
      {({ pressed }) => (
        <View
          style={{
            borderRadius: ui.radius.md,
            minHeight: 44,
            paddingVertical: 11,
            paddingHorizontal: 14,
            backgroundColor: buttonBackground,
            opacity: pressed ? 0.85 : 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: buttonTextColor,
              textAlign: 'center',
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.md,
              lineHeight: 20,
            }}
            numberOfLines={2}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
};
