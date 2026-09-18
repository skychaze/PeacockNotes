import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedRing } from '../components/AnimatedRing';
import { AppText } from '../components/AppText';
import { IconButton } from '../components/IconButton';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { ProgressFill } from '../components/ProgressFill';
import { PressableScale } from '../components/PressableScale';
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

type FileMetadata = {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
};

const FILE_SCAN_CONCURRENCY = 8;

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  concurrency = FILE_SCAN_CONCURRENCY,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]);
      }
    })
  );

  return results;
};

const getCachedFileInfo = async (
  uri: string,
  metadata: Map<string, FileMetadata>,
): Promise<FileMetadata> => {
  const cached = metadata.get(uri);
  if (cached) {
    return cached;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    const value: FileMetadata = {
      exists: info.exists,
      isDirectory: info.isDirectory,
      size: 'size' in info ? Number(info.size ?? 0) : 0,
    };
    metadata.set(uri, value);
    return value;
  } catch {
    const value: FileMetadata = { exists: false };
    metadata.set(uri, value);
    return value;
  }
};

const scanDirectory = async (
  rootUri: string,
  metadata: Map<string, FileMetadata>,
  visitedDirectories: Set<string>,
  scannedFiles: Set<string>,
): Promise<void> => {
  if (!rootUri) {
    return;
  }
  const pendingDirectories = [rootUri];

  while (pendingDirectories.length > 0) {
    const directoryUri = pendingDirectories.shift();
    if (!directoryUri || visitedDirectories.has(directoryUri)) {
      continue;
    }
    visitedDirectories.add(directoryUri);

    let entries: string[];
    try {
      entries = await FileSystem.readDirectoryAsync(directoryUri);
    } catch {
      continue;
    }

    await mapWithConcurrency(entries, async (entry) => {
      const childUri = directoryUri.endsWith('/') ? `${directoryUri}${entry}` : `${directoryUri}/${entry}`;
      const info = await getCachedFileInfo(childUri, metadata);
      if (!info.exists) {
        return;
      }
      if (info.isDirectory) {
        pendingDirectories.push(childUri);
      } else {
        scannedFiles.add(childUri);
      }
    });
  }
};

const sumUris = async (uris: readonly string[], metadata: Map<string, FileMetadata>) => {
  const sizes = await mapWithConcurrency([...new Set(uris)], async (uri) => {
    const info = await getCachedFileInfo(uri, metadata);
    return info.exists && !info.isDirectory ? Number(info.size ?? 0) : 0;
  });
  return sizes.reduce((total, size) => total + size, 0);
};

const buildStorageViewModel = async (snapshot: StorageSnapshot): Promise<StorageViewModel> => {
  const metadata = new Map<string, FileMetadata>();
  const visitedDirectories = new Set<string>();
  const scannedFiles = new Set<string>();
  const roots = [FileSystem.documentDirectory, FileSystem.cacheDirectory].filter(
    (uri): uri is string => Boolean(uri)
  );

  await Promise.all(
    roots.map((rootUri) => scanDirectory(rootUri, metadata, visitedDirectories, scannedFiles))
  );

  const audioBytes = await sumUris(snapshot.audioUris, metadata);
  const fileBytes = await sumUris(snapshot.fileUris, metadata);
  const appDataBytes = [...scannedFiles].reduce(
    (total, uri) => total + Number(metadata.get(uri)?.size ?? 0),
    0
  );
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
  const [isClearingCache, setIsClearingCache] = useState(false);
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

  const clearCache = useCallback(async () => {
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory || isClearingCache) {
      return;
    }

    try {
      setIsClearingCache(true);
      const entries = await FileSystem.readDirectoryAsync(cacheDirectory);
      await Promise.all(
        entries.map((entry) =>
          FileSystem.deleteAsync(
            cacheDirectory.endsWith('/') ? `${cacheDirectory}${entry}` : `${cacheDirectory}/${entry}`,
            { idempotent: true },
          )
        )
      );
      await refreshStorage();
    } catch (error) {
      console.warn('Failed to clear cache:', error);
      Alert.alert(t('common.error'), t('storage.clearCacheError'));
    } finally {
      setIsClearingCache(false);
    }
  }, [isClearingCache, refreshStorage, t]);

  const confirmClearCache = () => {
    Alert.alert(t('storage.clearCacheTitle'), t('storage.clearCacheBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('storage.clearCache'), style: 'destructive', onPress: () => void clearCache() },
    ]);
  };

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
            {t('storage.noteCount', { count: storage.noteCount })} · {t('storage.notesText')} {formatBytes(storage.notesBytes)}
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

        <PressableScale
          onPress={confirmClearCache}
          disabled={isClearingCache}
          accessibilityRole="button"
          accessibilityLabel={t('storage.clearCache')}
          style={{
            marginTop: ui.space.lg,
            minHeight: 52,
            borderRadius: ui.radius.lg,
            backgroundColor: colors.surface,
            paddingHorizontal: ui.space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: ui.space.md,
            opacity: isClearingCache ? 0.5 : 1,
          }}
        >
          <MaterialCommunityIcons name="delete-sweep-outline" size={22} color={colors.error} />
          <AppText variant="headline" color={colors.error}>
            {t(isClearingCache ? 'storage.clearingCache' : 'storage.clearCache')}
          </AppText>
        </PressableScale>
      </ScrollView>

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
