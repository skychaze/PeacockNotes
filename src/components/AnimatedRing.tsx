import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';
import { useQuality } from '../theme/quality';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type AnimatedRingProps = {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor: string;
  children?: ReactNode;
};

export const AnimatedRing = ({
  progress,
  size,
  strokeWidth,
  color,
  trackColor,
  children,
}: AnimatedRingProps) => {
  const { motionEnabled } = useQuality();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = useSharedValue(0);

  useEffect(() => {
    const target = Math.min(Math.max(progress, 0), 1);
    value.value = motionEnabled
      ? withTiming(target, { duration: 900, easing: Easing.out(Easing.cubic) })
      : target;
  }, [motionEnabled, progress, value]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - value.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>{children}</View>
    </View>
  );
};
