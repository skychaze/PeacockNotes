import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

type GlassSurfaceProps = PropsWithChildren<{
  radius: number;
  blurOn?: 'all' | 'ios';
  intensity?: number;
  fallbackColor?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export const GlassSurface = ({
  radius,
  blurOn = 'all',
  intensity,
  fallbackColor,
  style,
  contentStyle,
  children,
}: GlassSurfaceProps) => {
  const { colors } = useAppColors();
  const { blurEnabled } = useQuality();
  const blurActive = blurEnabled && (blurOn === 'all' || Platform.OS === 'ios');

  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.glassBorder,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {blurActive ? (
        <BlurView
          intensity={intensity ?? 20}
          blurReductionFactor={1}
          tint="default"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={[
          { backgroundColor: blurActive ? colors.glass : fallbackColor ?? colors.surface },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
};
