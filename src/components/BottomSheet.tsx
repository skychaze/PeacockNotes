import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { useAppColors } from '../theme/useAppColors';
import { useQuality } from '../theme/quality';
import { ui } from '../theme/ui';

type BottomSheetProps = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title?: string;
}>;

export const BottomSheet = ({ visible, onClose, title, children }: BottomSheetProps) => {
  const { colors } = useAppColors();
  const { motionEnabled } = useQuality();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const { height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(visible);
  const travel = Math.min(height * 0.8, 640);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.4 }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - progress.value) * travel -
          Math.max(0, keyboard.height.value - insets.bottom),
      },
    ],
  }));

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = motionEnabled
        ? withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) })
        : withTiming(1, { duration: 150 });
    } else {
      progress.value = withTiming(0, { duration: motionEnabled ? 200 : 0 }, (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
        }
      });
    }
  }, [motionEnabled, progress, visible]);

  useEffect(() => {
    if (!visible || !isFocused) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, onClose, visible]);

  if (!mounted) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={panelStyle}>
          <GlassSurface
            radius={ui.radius.sheet}
            contentStyle={{ paddingBottom: ui.space.xl }}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            <View style={{ alignItems: 'center', paddingTop: ui.space.sm }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.textSecondary,
                  opacity: 0.4,
                }}
              />
            </View>
            {title ? (
              <AppText
                variant="title"
                style={{ paddingHorizontal: ui.space.lg, paddingTop: ui.space.md }}
              >
                {title}
              </AppText>
            ) : null}
            <View style={{ paddingTop: ui.space.md }}>{children}</View>
          </GlassSurface>
        </Animated.View>
      </View>
    </View>
  );
};
