import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

const IDLE = [0.35, 0.6, 0.45, 0.75, 0.5, 0.4, 0.65];
const LOUD = [0.7, 1, 0.8, 1, 0.85, 0.6, 0.9];
const BAR_HEIGHT = 20;

type BarProps = {
  index: number;
  active: boolean;
  color: string;
};

const Bar = ({ index, active, color }: BarProps) => {
  const scale = useSharedValue(IDLE[index]);

  useEffect(() => {
    if (!active) {
      scale.value = withTiming(IDLE[index], { duration: 200 });
      return;
    }
    scale.value = withDelay(
      index * 40,
      withRepeat(
        withSequence(
          withTiming(LOUD[index], { duration: 300, easing: Easing.inOut(Easing.quad) }),
          withTiming(IDLE[index], { duration: 300, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(scale);
  }, [active, index, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));

  return (
    <Animated.View
      style={[{ width: 4, height: BAR_HEIGHT, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
};

type AnimatedBarsProps = { playing: boolean; color?: string };

export const AnimatedBars = ({ playing, color }: AnimatedBarsProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const active = playing && motionEnabled;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {IDLE.map((_, index) => (
        <Bar key={index} index={index} active={active} color={color ?? colors.primary} />
      ))}
    </View>
  );
};
