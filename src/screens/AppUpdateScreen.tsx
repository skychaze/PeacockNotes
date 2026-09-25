import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { ProgressFill } from '../components/ProgressFill';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useLanguage } from '../i18n/LanguageContext';
import {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateSnapshot,
  installAppUpdate,
  subscribeAppUpdate,
  type AppUpdateSnapshot,
} from '../services/appUpdate';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'AppUpdate'>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

type UpdatePresentation = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  status: string | null;
  action: string | null;
  busy: boolean;
};

const describeUpdate = (update: AppUpdateSnapshot, t: Translate): UpdatePresentation => {
  switch (update.phase) {
    case 'checking':
      return { icon: 'update', status: t('update.checking'), action: null, busy: true };
    case 'current':
      return { icon: 'check-circle-outline', status: t('update.latest'), action: null, busy: false };
    case 'available':
      return {
        icon: 'download-circle-outline',
        status: update.error === 'download'
          ? t('update.downloadError')
          : t('update.available', { version: update.release?.versionName ?? '' }),
        action: t('update.download'),
        busy: false,
      };
    case 'downloading':
      return {
        icon: 'download-circle-outline',
        status: update.waitingFor === 'wifi'
          ? t('update.waitingForWifi')
          : update.waitingFor === 'network'
            ? t('update.waitingForNetwork')
            : t('update.downloading', {
                version: update.release?.versionName ?? '',
                percent: Math.round(update.progress * 100),
              }),
        action: null,
        busy: true,
      };
    case 'ready':
      return { icon: 'download-circle-outline', status: t('update.ready'), action: t('update.install'), busy: false };
    case 'error':
      return { icon: 'update', status: t('update.checkError'), action: t('update.retry'), busy: false };
    default:
      return { icon: 'update', status: null, action: null, busy: false };
  }
};

export const AppUpdateScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [update, setUpdate] = useState<AppUpdateSnapshot>(getAppUpdateSnapshot());

  useFocusEffect(
    useCallback(() => {
      setUpdate(getAppUpdateSnapshot());
      const unsubscribe = subscribeAppUpdate(setUpdate);
      const phase = getAppUpdateSnapshot().phase;
      if (phase === 'idle' || phase === 'current' || phase === 'error') {
        void checkForAppUpdate();
      }
      return unsubscribe;
    }, [])
  );

  const onAction = () => {
    if (update.phase === 'available') void downloadAppUpdate();
    else if (update.phase === 'ready') void installAppUpdate();
    else void checkForAppUpdate();
  };

  const presentation = describeUpdate(update, t);
  const installedLabel = update.installed
    ? `v${update.installed.versionName} (${update.installed.versionCode})`
    : null;

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + ui.space.xxl, ui.space.xxxl) }}
        style={{
          flex: 1,
          paddingHorizontal: ui.space.lg,
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
        }}
      >
        <AppText variant="display" style={{ marginBottom: ui.space.lg }}>
          {t('header.updates')}
        </AppText>

        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: ui.radius.lg,
            padding: ui.space.lg,
            gap: ui.space.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceVariant,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons
                name={presentation.icon}
                size={22}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1, gap: ui.space.xs }}>
              {installedLabel ? <AppText variant="headline">{installedLabel}</AppText> : null}
              {presentation.status ? (
                <AppText variant="bodySmall" color={colors.textSecondary}>
                  {presentation.status}
                </AppText>
              ) : null}
            </View>
          </View>

          {update.phase === 'downloading' ? (
            <ProgressFill
              progress={update.progress}
              trackColor={colors.surfaceVariant}
              fillColor={colors.primary}
            />
          ) : null}
        </View>

        {presentation.action ? (
          <View style={{ marginTop: ui.space.lg }}>
            <PrimaryButton onPress={onAction}>{presentation.action}</PrimaryButton>
          </View>
        ) : null}
      </ScrollView>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
        <IconButton
          icon="refresh"
          disabled={presentation.busy}
          accessibilityLabel={t('update.check')}
          onPress={() => void checkForAppUpdate()}
        />
      </TopBar>
    </ScreenContainer>
  );
};
