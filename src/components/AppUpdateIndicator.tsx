import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { PressableScale } from './PressableScale';
import { AnimatedRing } from './AnimatedRing';
import { useLanguage } from '../i18n/LanguageContext';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { AppUpdatePhase } from '../services/appUpdate';

type AppUpdateIndicatorProps = {
  phase: AppUpdatePhase;
  progress: number;
  versionName: string | null;
  onPress: () => void;
};

export const AppUpdateIndicator = ({
  phase,
  progress,
  versionName,
  onPress,
}: AppUpdateIndicatorProps) => {
  const { colors } = useAppColors();
  const { t } = useLanguage();
  const isDownloading = phase === 'downloading';
  const isReady = phase === 'ready';

  if (!isDownloading && !isReady) return null;

  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isReady
        ? t('update.install')
        : t('update.downloading', { version: versionName ?? '', percent })}
      accessibilityState={{ busy: isDownloading }}
      style={{
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AnimatedRing
        progress={isReady ? 1 : progress}
        size={38}
        strokeWidth={3}
        color={colors.primary}
        trackColor={colors.surfaceVariant}
      >
        <ViewCenter color={colors.surfaceVariant}>
          <MaterialCommunityIcons
            name={isReady ? 'download' : 'download-outline'}
            size={18}
            color={colors.primary}
          />
        </ViewCenter>
      </AnimatedRing>
    </PressableScale>
  );
};

type ViewCenterProps = {
  color: string;
  children: ReactNode;
};

const ViewCenter = ({ color, children }: ViewCenterProps) => (
  <View
    style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      margin: ui.space.sm,
      borderRadius: ui.radius.pill,
      backgroundColor: color,
    }}
  >
    {children}
  </View>
);
