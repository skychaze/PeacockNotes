import { Audio } from 'expo-av';
import { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, View } from 'react-native';
import { AnimatedRing } from './AnimatedRing';
import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { IconButton } from './IconButton';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import { useLanguage } from '../i18n/LanguageContext';

type EditorRecordingBarProps = {
  recording: Audio.Recording;
  isPaused: boolean;
  appendGroupId: string | null;
  onTogglePause: () => void;
  onStop: () => void;
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
  const remainingSeconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

export const EditorRecordingBar = ({
  recording,
  isPaused,
  appendGroupId,
  onTogglePause,
  onStop,
}: EditorRecordingBarProps) => {
  const { colors } = useAppColors();
  const { t } = useLanguage();
  const [recordSeconds, setRecordSeconds] = useState(0);
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    setRecordSeconds(0);
  }, [recording]);

  useEffect(() => {
    if (isPaused) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    const pulseLoop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, {
          toValue: 1.45,
          duration: 650,
          useNativeDriver: true,
        }),
        RNAnimated.timing(pulseAnim, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    return () => pulseLoop.stop();
  }, [isPaused, pulseAnim, recording]);

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const timer = setInterval(() => {
      setRecordSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isPaused, recording]);

  return (
    <View
      style={{
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
        flex: 1,
      }}
    >
      <GlassSurface radius={ui.radius.xl} contentStyle={{ padding: ui.space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: ui.space.md,
            paddingHorizontal: ui.space.sm,
          }}
        >
          <AnimatedRing
            progress={1}
            size={36}
            strokeWidth={3}
            color={colors.primary}
            trackColor={colors.surfaceVariant}
          >
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <RNAnimated.View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: colors.error,
                  transform: [{ scale: pulseAnim }],
                }}
              />
            </View>
          </AnimatedRing>
          <AppText variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
            {isPaused
              ? appendGroupId
                ? t('editor.appendingPaused', { time: formatDuration(recordSeconds) })
                : t('editor.recordPaused', { time: formatDuration(recordSeconds) })
              : appendGroupId
                ? t('editor.appending', { time: formatDuration(recordSeconds) })
                : t('editor.recording', { time: formatDuration(recordSeconds) })}
          </AppText>
          <IconButton
            icon={isPaused ? 'play' : 'pause'}
            onPress={onTogglePause}
            accessibilityLabel={isPaused ? t('editor.recordResume') : t('editor.recordPause')}
          />
          <IconButton
            icon="stop"
            danger
            onPress={onStop}
            accessibilityLabel={t('editor.recordStop')}
          />
        </View>
      </GlassSurface>
    </View>
  );
};
