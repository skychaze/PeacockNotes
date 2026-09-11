import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { PressableScale } from '../components/PressableScale';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { useLanguage } from '../i18n/LanguageContext';
import {
  chooseBackupFolder,
  disconnectBackupFolder,
  getBackupFolderState,
  type BackupFolderState,
} from '../services/backupFolder';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Backup'>;

const EMPTY_STATE: BackupFolderState = { status: 'disconnected', uri: null, name: null };

export const BackupScreen = () => {
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors } = useAppColors();
  const { t } = useLanguage();
  const [folder, setFolder] = useState<BackupFolderState>(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isChoosing, setIsChoosing] = useState(false);

  const loadFolder = useCallback(async () => {
    try {
      setFolder(await getBackupFolderState());
    } catch (error) {
      console.warn('Failed to restore backup folder authorization:', error);
      setFolder({ status: 'unavailable', uri: null, name: null });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadFolder();
    }, [loadFolder])
  );

  const chooseFolder = async () => {
    try {
      setIsChoosing(true);
      setFolder(await chooseBackupFolder());
    } catch (error) {
      if ((error as { code?: string }).code === 'PICKER_CANCELLED') return;
      console.warn('Failed to choose backup folder:', error);
      Alert.alert(t('common.error'), t('backup.chooseError'));
    } finally {
      setIsChoosing(false);
    }
  };

  const disconnect = () => {
    Alert.alert(t('backup.disconnectTitle'), t('backup.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            setFolder(await disconnectBackupFolder());
          } catch (error) {
            console.warn('Failed to disconnect backup folder:', error);
            Alert.alert(t('common.error'), t('backup.disconnectError'));
          }
        },
      },
    ]);
  };

  const isConnected = folder.status === 'connected';
  const hasStaleAuthorization = folder.status === 'revoked' || folder.status === 'unavailable';
  const statusColor = isConnected ? colors.primary : hasStaleAuthorization ? colors.error : colors.textSecondary;
  const statusIcon = isConnected ? 'folder-check-outline' : hasStaleAuthorization ? 'folder-alert-outline' : 'folder-outline';

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
          paddingHorizontal: ui.space.lg,
          paddingBottom: Math.max(insets.bottom + ui.space.xxl, ui.space.xxxl),
          gap: ui.space.lg,
        }}
      >
        <View style={{ gap: ui.space.sm }}>
          <AppText variant="display">{t('header.backup')}</AppText>
          <AppText variant="body" color={colors.textSecondary}>
            {t('backup.intro')}
          </AppText>
        </View>

        <Card style={{ gap: ui.space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ui.space.md }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: ui.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceVariant,
              }}
            >
              <MaterialCommunityIcons name={statusIcon} size={26} color={statusColor} />
            </View>
            <View style={{ flex: 1, gap: ui.space.xs }}>
              <AppText variant="headline">
                {isLoading ? t('common.loading') : t(`backup.status.${folder.status}`)}
              </AppText>
              <AppText variant="bodySmall" color={colors.textSecondary} numberOfLines={3}>
                {isConnected
                  ? t('backup.connectedHelp')
                  : hasStaleAuthorization
                    ? t(`backup.help.${folder.status}`)
                    : t('backup.disconnectedHelp')}
              </AppText>
            </View>
          </View>

          {folder.name || folder.uri ? (
            <View style={{ gap: ui.space.xs }}>
              <AppText variant="caption" color={colors.textSecondary}>
                {t('backup.folderLabel')}
              </AppText>
              <AppText variant="body" numberOfLines={2}>
                {folder.name ?? folder.uri}
              </AppText>
            </View>
          ) : null}

          <PrimaryButton onPress={() => void chooseFolder()} disabled={isLoading || isChoosing}>
            {isChoosing
              ? t('backup.openingPicker')
              : isConnected || hasStaleAuthorization
                ? t('backup.changeFolder')
                : t('backup.connectFolder')}
          </PrimaryButton>

          {isConnected || hasStaleAuthorization ? (
            <PressableScale
              accessibilityRole="button"
              onPress={disconnect}
              style={{ alignSelf: 'center', padding: ui.space.sm }}
            >
              <AppText variant="headline" color={colors.error}>
                {hasStaleAuthorization ? t('backup.clearFolder') : t('backup.disconnect')}
              </AppText>
            </PressableScale>
          ) : null}
        </Card>

        <AppText variant="bodySmall" color={colors.textSecondary}>
          {t('backup.deviceLocal')}
        </AppText>
      </ScrollView>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
      </TopBar>
    </ScreenContainer>
  );
};
