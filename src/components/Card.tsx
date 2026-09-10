import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { PressableScale } from './PressableScale';
import { useAppColors } from '../theme/useAppColors';
import { ui } from '../theme/ui';

type CardProps = PropsWithChildren<{
  onPress?: () => void;
  onLongPress?: () => void;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}>;

export const Card = ({ onPress, onLongPress, tint, style, children }: CardProps) => {
  const { colors } = useAppColors();
  const baseStyle: ViewStyle = {
    backgroundColor: tint ?? colors.surface,
    borderRadius: ui.radius.lg,
    padding: ui.space.lg,
  };

  if (onPress || onLongPress) {
    return (
      <PressableScale onPress={onPress} onLongPress={onLongPress} style={[baseStyle, style]}>
        {children}
      </PressableScale>
    );
  }

  return <View style={[baseStyle, style]}>{children}</View>;
};
