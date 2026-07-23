import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useAppColors } from '../theme/useAppColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const ScreenContainer = ({ children }: PropsWithChildren) => {
  const { colors } = useAppColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: -80,
          right: -40,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: colors.accent,
          opacity: 0.12,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -120,
          left: -70,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: colors.primary,
          opacity: 0.1,
        }}
      />
      {children}
    </View>
  );
};
