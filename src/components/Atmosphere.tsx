import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

type GlowProps = {
  color: string;
  size: number;
  opacity: number;
  driftMs: number;
  style: { top?: number; bottom?: number; left?: number; right?: number };
  animate: boolean;
};

const Glow = ({ color, size, opacity, driftMs, style, animate }: GlowProps) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = animate
      ? withRepeat(
          withTiming(1, { duration: driftMs, easing: Easing.inOut(Easing.quad) }),
          -1,
          true
        )
      : 0;
  }, [animate, driftMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * 10 - 5 },
      { translateY: progress.value * 10 - 5 },
      { scale: 1 + progress.value * 0.06 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          overflow: 'hidden',
        },
        style,
        animatedStyle,
      ]}
    >
      <LinearGradient
        colors={[color, `${color}00`]}
        start={{ x: 0.2, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
};

export const Atmosphere = () => {
  const { colors } = useAppColors();
  const { ambientDrift } = useQuality();
  const { width } = useWindowDimensions();
  const size = Math.round(width * 0.9);
  const [a, b, c] = colors.atmosphere;
  const opacity = colors.atmosphereOpacity;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.background, colors.backgroundDeep]}
        style={StyleSheet.absoluteFill}
      />
      <Glow
        color={a}
        size={size}
        opacity={opacity}
        driftMs={18000}
        style={{ top: -width * 0.35, left: -width * 0.25 }}
        animate={ambientDrift}
      />
      <Glow
        color={b}
        size={size}
        opacity={opacity}
        driftMs={24000}
        style={{ top: -width * 0.15, right: -width * 0.35 }}
        animate={ambientDrift}
      />
      <Glow
        color={c}
        size={size}
        opacity={opacity}
        driftMs={30000}
        style={{ bottom: -width * 0.4, left: width * 0.05 }}
        animate={ambientDrift}
      />
    </View>
  );
};
