import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GestureResponderEvent } from 'react-native';
import { PressableScale } from './PressableScale';
import { useAppColors } from '../theme/useAppColors';
import { ui } from '../theme/ui';

type IconButtonProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  square?: boolean;
  size?: number;
  accessibilityLabel?: string;
};

export const IconButton = ({
  icon,
  onPress,
  disabled = false,
  danger = false,
  square = false,
  size = 22,
  accessibilityLabel,
}: IconButtonProps) => {
  const { colors } = useAppColors();

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 40,
        height: 40,
        borderRadius: square ? ui.radius.md : ui.radius.pill,
        backgroundColor: colors.surfaceVariant,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <MaterialCommunityIcons
        name={icon}
        size={size}
        color={danger ? colors.error : colors.text}
      />
    </PressableScale>
  );
};
