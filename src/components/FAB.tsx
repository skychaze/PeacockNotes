import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from './PressableScale';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';
import { ui } from '../theme/ui';

type FABProps = {
  onPress: () => void;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  bottom: number;
};

export const FAB = ({ onPress, icon, bottom }: FABProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const scale = useSharedValue(motionEnabled ? 0.7 : 1);

  useEffect(() => {
    scale.value = motionEnabled
      ? withDelay(150, withSpring(1, { damping: 12, stiffness: 220 }))
      : 1;
  }, [motionEnabled, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          right: 18,
          bottom,
          borderRadius: ui.radius.fab,
          shadowColor: '#000000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
        animatedStyle,
      ]}
    >
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        style={{ borderRadius: ui.radius.fab, overflow: 'hidden' }}
      >
        <LinearGradient
          colors={colors.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 56,
            height: 56,
            borderRadius: ui.radius.fab,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name={icon} size={26} color={colors.onPrimary} />
        </LinearGradient>
      </PressableScale>
    </Animated.View>
  );
};
