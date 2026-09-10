import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedRing } from '../components/AnimatedRing';
import { AppText } from '../components/AppText';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { ProgressFill } from '../components/ProgressFill';
import { ScreenContainer } from '../components/ScreenContainer';
import { TOP_BAR_HEIGHT, TopBar } from '../components/TopBar';
import { getStorageSnapshot, type StorageSnapshot } from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { FOLDER_ACCENTS } from '../theme/colors';
import { ui } from '../theme/ui';
import { useAppColors } from '../theme/useAppColors';
import type { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'StorageUsage'>;

type StorageViewModel = {
  noteCount: number;
  notesBytes: number;
  audioBytes: number;
  fileBytes: number;
  databaseBytes: number;
  otherBytes: number;
  totalBytes: number;
};

const splitBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { value: '0', unit: 'B' };
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value < 10 ? 2 : 1;
  return { value: value.toFixed(decimals), unit: units[unitIndex] };
};

const formatBytes = (bytes: number) => {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
};

const getDirectorySize = async (directoryUri: string, visited: Set<string>): Promise<number> => {
  if (!directoryUri || visited.has(directoryUri)) {
    return 0;
  }

  visited.add(directoryUri);

  let entries: string[] = [];
  try {
    entries = await FileSystem.readDirectoryAsync(directoryUri);
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const childUri = directoryUri.endsWith('/') ? `${directoryUri}${entry}` : `${directoryUri}/${entry}`;
    try {
      const info = await FileSystem.getInfoAsync(childUri);
      if (!info.exists) {
        continue;
      }
      if (info.isDirectory) {
        total += await getDirectorySize(childUri, visited);
        continue;
      }
      total += Number(info.size ?? 0);
    } catch {
      continue;
    }
  }

  return total;
};

const getUrisSize = async (uris: string[]) => {
  let total = 0;
  for (const uri of new Set(uris)) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) {
        continue;
      }
      total += Number(info.size ?? 0);
    } catch {
      continue;
    }
  }
  return total;
};

const buildStorageViewModel = async (snapshot: StorageSnapshot): Promise<StorageViewModel> => {
  const audioBytes = await getUrisSize(snapshot.audioUris);
  const fileBytes = await getUrisSize(snapshot.fileUris);
  const visited = new Set<string>();
  const documentBytes = FileSystem.documentDirectory
    ? await getDirectorySize(FileSystem.documentDirectory, visited)
    : 0;
  const cacheBytes = FileSystem.cacheDirectory
    ? await getDirectorySize(FileSystem.cacheDirectory, visited)
    : 0;
  const appDataBytes = documentBytes + cacheBytes;
  const otherBytes = Math.max(0, appDataBytes - audioBytes - fileBytes - snapshot.databaseBytes);
  const totalBytes = audioBytes + fileBytes + snapshot.databaseBytes + otherBytes;

  return {
    noteCount: snapshot.noteCount,
    notesBytes: snapshot.notesTextBytes,
    audioBytes,
    fileBytes,
    databaseBytes: snapshot.databaseBytes,
    otherBytes,
    totalBytes,
  };
};

const ROWS = [
  { key: 'notes', labelKey: 'storage.notesText', icon: 'text-box-outline', valueKey: 'notesBytes' },
  { key: 'audio', labelKey: 'storage.audioFiles', icon: 'music-note', valueKey: 'audioBytes' },
  { key: 'files', labelKey: 'storage.imageFiles', icon: 'file-image-outline', valueKey: 'fileBytes' },
  { key: 'db', labelKey: 'storage.database', icon: 'database-outline', valueKey: 'databaseBytes' },
  { key: 'other', labelKey: 'storage.otherFiles', icon: 'folder-outline', valueKey: 'otherBytes' },
] as const;

export const StorageUsageScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors, isDark } = useAppColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [storage, setStorage] = useState<StorageViewModel>({
    noteCount: 0,
    notesBytes: 0,
    audioBytes: 0,
    fileBytes: 0,
    databaseBytes: 0,
    otherBytes: 0,
    totalBytes: 0,
  });

  const refreshStorage = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const snapshot = await getStorageSnapshot();
      const next = await buildStorageViewModel(snapshot);
      setStorage(next);
    } catch (error) {
      console.warn('Failed to load storage usage:', error);
      Alert.alert(t('common.error'), t('storage.loadError'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refreshStorage();
    }, [refreshStorage])
  );

  const rows = useMemo(
    () =>
      ROWS.map((row) => ({
        key: row.key,
        label: t(row.labelKey),
        icon: row.icon,
        value: storage[row.valueKey],
      })),
    [storage, t]
  );

  const total = splitBytes(storage.totalBytes);

  return (
    <ScreenContainer>
      <View
        style={{
          flex: 1,
          paddingHorizontal: ui.space.lg,
          paddingTop: insets.top + ui.space.sm + TOP_BAR_HEIGHT + ui.space.md,
        }}
      >
        <AppText variant="display" style={{ marginBottom: ui.space.lg }}>
          {t('header.storageUsage')}
        </AppText>

        <View style={{ alignItems: 'center', marginBottom: ui.space.lg }}>
          <AnimatedRing
            progress={isLoading ? 0 : 1}
            size={170}
            strokeWidth={12}
            color={colors.primary}
            trackColor={colors.surfaceVariant}
          >
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <AppText variant="display">{total.value}</AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                {total.unit}
              </AppText>
            </View>
          </AnimatedRing>
          <AppText variant="caption" color={colors.textSecondary} style={{ marginTop: ui.space.sm }}>
            {t('storage.totalLabel')}
          </AppText>
          <AppText variant="bodySmall" color={colors.textSecondary}>
            {t('storage.noteCount', { count: storage.noteCount })}
          </AppText>
        </View>

        <View style={{ gap: ui.space.md }}>
          {rows.map((row, index) => {
            const accent = FOLDER_ACCENTS[index % FOLDER_ACCENTS.length];
            const tint = isDark ? accent.dark : accent.light;
            const ink = isDark ? accent.inkDark : accent.inkLight;
            const ratio = storage.totalBytes > 0 ? Math.min(1, row.value / storage.totalBytes) : 0;

            return (
              <View
                key={row.key}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: ui.radius.lg,
                  padding: ui.space.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ui.space.md,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: tint,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name={row.icon} size={22} color={ink} />
                </View>
                <View style={{ flex: 1, gap: ui.space.sm }}>
                  <AppText variant="bodySmall" numberOfLines={1}>
                    {row.label}
                  </AppText>
                  <ProgressFill
                    progress={ratio}
                    trackColor={colors.surfaceVariant}
                    fillColor={colors.primary}
                  />
                </View>
                <AppText variant="caption" color={colors.textSecondary}>
                  {formatBytes(row.value)}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>

      <TopBar onBack={() => navigation.goBack()}>
        <LanguageToggleButton />
        <IconButton
          icon="refresh"
          disabled={isRefreshing}
          accessibilityLabel={isRefreshing ? t('storage.refreshing') : t('storage.refresh')}
          onPress={() => void refreshStorage()}
        />
      </TopBar>
    </ScreenContainer>
  );
};
