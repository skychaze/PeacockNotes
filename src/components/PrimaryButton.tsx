import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { useAppColors } from '../theme/useAppColors';
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

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{
        borderRadius: ui.radius.pill,
        overflow: 'hidden',
        backgroundColor: disabled ? colors.surfaceVariant : colors.primary,
      }}
    >
      <LinearGradient
        colors={
          disabled
            ? [colors.surfaceVariant, colors.surfaceVariant]
            : ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']
        }
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: ui.space.lg,
        }}
      >
        <AppText
          variant="headline"
          color={disabled ? colors.textSecondary : colors.onPrimary}
          numberOfLines={2}
          style={{ textAlign: 'center' }}
        >
          {children}
        </AppText>
      </LinearGradient>
    </PressableScale>
  );
};
