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
  type AppUpdatePhase,
  type AppUpdateSnapshot,
} from '../services/appUpdate';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'AppUpdate'>;

const stateIcon = (phase: AppUpdatePhase): keyof typeof MaterialCommunityIcons.glyphMap => {
  switch (phase) {
    case 'current':
      return 'check-circle-outline';
    case 'available':
    case 'downloading':
    case 'ready':
      return 'download-circle-outline';
    default:
      return 'update';
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
      void checkForAppUpdate();
      return unsubscribe;
    }, [])
  );

  const onAction = () => {
    if (update.phase === 'available') void downloadAppUpdate();
    else if (update.phase === 'ready') void installAppUpdate();
    else void checkForAppUpdate();
  };

  const installedLabel = update.installed
    ? `v${update.installed.versionName} (${update.installed.versionCode})`
    : null;

  const statusText = (() => {
    switch (update.phase) {
      case 'checking':
        return t('update.checking');
      case 'current':
        return t('update.latest');
      case 'available':
        return update.release
          ? t('update.available', { version: update.release.versionName })
          : null;
      case 'downloading':
        return t('update.downloading', { percent: Math.round(update.progress * 100) });
      case 'ready':
        return t('update.ready');
      case 'error':
        return update.error === 'download' ? t('update.downloadError') : t('update.checkError');
      default:
        return null;
    }
  })();

  const actionLabel = (() => {
    switch (update.phase) {
      case 'available':
        return t('update.download');
      case 'ready':
        return t('update.install');
      case 'error':
        return t('update.retry');
      default:
        return null;
    }
  })();

  const isBusy = update.phase === 'checking' || update.phase === 'downloading';

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
                name={stateIcon(update.phase)}
                size={22}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1, gap: ui.space.xs }}>
              {installedLabel ? <AppText variant="headline">{installedLabel}</AppText> : null}
              {statusText ? (
                <AppText variant="bodySmall" color={colors.textSecondary}>
                  {statusText}
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

        {actionLabel ? (
          <View style={{ marginTop: ui.space.lg }}>
            <PrimaryButton onPress={onAction}>{actionLabel}</PrimaryButton>
          </View>
        ) : null}
      </ScrollView>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
        <IconButton
          icon="refresh"
          disabled={isBusy}
          accessibilityLabel={t('update.check')}
          onPress={() => void checkForAppUpdate()}
        />
      </TopBar>
    </ScreenContainer>
  );
};
