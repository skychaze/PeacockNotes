import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useQuality } from '../theme/quality';

type ProgressFillProps = {
  progress: number;
  trackColor: string;
  fillColor: string;
};

export const ProgressFill = ({ progress, trackColor, fillColor }: ProgressFillProps) => {
  const { motionEnabled } = useQuality();
  const value = useSharedValue(0);

  useEffect(() => {
    const target = Math.min(1, Math.max(0, progress));
    value.value = motionEnabled ? withTiming(target, { duration: 400 }) : target;
  }, [motionEnabled, progress, value]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: value.value }] }));

  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: trackColor, overflow: 'hidden' }}>
      <Animated.View
        style={[
          { height: 3, borderRadius: 2, backgroundColor: fillColor, transformOrigin: 'left' },
          fillStyle,
        ]}
      />
    </View>
  );
};
