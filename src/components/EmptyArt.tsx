import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type EmptyArtName = 'folders' | 'notes' | 'search' | 'generic';

const PATHS: Record<EmptyArtName, string[]> = {
  folders: [
    'M22 44 h24 l8 10 h44 a8 8 0 0 1 8 8 v34 a8 8 0 0 1 -8 8 h-76 a8 8 0 0 1 -8 -8 v-44 a8 8 0 0 1 8 -8 z',
    'M36 76 h48',
    'M36 88 h34',
  ],
  notes: [
    'M40 20 h40 a6 6 0 0 1 6 6 v68 a6 6 0 0 1 -6 6 h-40 a6 6 0 0 1 -6 -6 v-68 a6 6 0 0 1 6 -6 z',
    'M48 44 h32',
    'M48 58 h32',
    'M48 72 h20',
  ],
  search: [
    'M56 34 a22 22 0 1 1 0 44 a22 22 0 1 1 0 -44',
    'M72 72 l18 18',
  ],
  generic: [
    'M34 46 h52 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-52 a8 8 0 0 1 -8 -8 v-40 a8 8 0 0 1 8 -8 z',
    'M42 68 h36',
    'M42 82 h24',
  ],
};

// The dash length only has to exceed the real path length (all paths live in a
// 120 box), so no runtime measurement is needed.
const DASH = 400;

type DrawPathProps = {
  d: string;
  delay: number;
  color: string;
};

const DrawPath = ({ d, delay, color }: DrawPathProps) => {
  const { motionEnabled } = useQuality();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = motionEnabled
      ? withDelay(delay, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }))
      : 1;
  }, [delay, motionEnabled, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: DASH * (1 - progress.value),
  }));

  return (
    <AnimatedPath
      d={d}
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      strokeDasharray={`${DASH} ${DASH}`}
      animatedProps={animatedProps}
    />
  );
};

type EmptyArtProps = { name: EmptyArtName; size?: number };

export const EmptyArt = ({ name, size = 56 }: EmptyArtProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = motionEnabled
      ? withRepeat(
          withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
          -1,
          true
        )
      : 0;
  }, [motionEnabled, float]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value * -4 }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, floatStyle]}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        {PATHS[name].map((d, index) => (
          <DrawPath key={d} d={d} delay={index * 90} color={colors.textSecondary} />
        ))}
      </Svg>
    </Animated.View>
  );
};
