import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { getStorageSnapshot, type StorageSnapshot } from '../database/schema';
import { useLanguage } from '../i18n/LanguageContext';
import { getContrastColor } from '../theme/contrast';
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

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value < 10 ? 2 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
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
  const totalBytes = snapshot.notesTextBytes + audioBytes + fileBytes + snapshot.databaseBytes + otherBytes;

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

export const StorageUsageScreen = () => {
  const navigation = useNavigation<Navigation>();
  const { colors } = useAppColors();
  const { t, language } = useLanguage();
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

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('header.storageUsage'),
      headerRight: () => <LanguageToggleButton />,
    });
  }, [language, navigation, t]);

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
    () => [
      { key: 'notes', label: t('storage.notesText'), value: storage.notesBytes, color: '#6CD4C8' },
      { key: 'audio', label: t('storage.audioFiles'), value: storage.audioBytes, color: '#FFD57E' },
      { key: 'files', label: t('storage.imageFiles'), value: storage.fileBytes, color: '#B8A9FF' },
      { key: 'db', label: t('storage.database'), value: storage.databaseBytes, color: '#9FD1FF' },
      { key: 'other', label: t('storage.otherFiles'), value: storage.otherBytes, color: '#FFBEA8' },
    ],
    [storage.audioBytes, storage.databaseBytes, storage.fileBytes, storage.notesBytes, storage.otherBytes, t]
  );

  const actionTextColor = getContrastColor(colors.primary, colors.text, '#FFFFFF');

  return (
    <ScreenContainer>
      <View style={{ flex: 1, paddingHorizontal: ui.space.md, paddingTop: ui.space.sm }}>
        <View
          style={{
            borderRadius: ui.radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: ui.space.md,
            marginBottom: ui.space.sm,
          }}
        >
          <Text
            style={{
              color: colors.textSecondary,
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.sm,
            }}
          >
            {t('storage.totalLabel')}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontFamily: 'NotoSansBengali',
              fontSize: 30,
              lineHeight: 40,
              marginTop: 2,
            }}
          >
            {formatBytes(storage.totalBytes)}
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontFamily: 'NotoSansBengali',
              fontSize: ui.font.sm,
            }}
          >
            {t('storage.noteCount', { count: storage.noteCount })}
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          {rows.map((row) => (
            <View
              key={row.key}
              style={{
                borderRadius: ui.radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                paddingVertical: 11,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: row.color }} />
                <Text style={{ color: colors.text, fontFamily: 'NotoSansBengali', fontSize: ui.font.md, flex: 1 }}>
                  {row.label}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
                {formatBytes(row.value)}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => void refreshStorage()}
          disabled={isRefreshing}
          style={{
            marginTop: ui.space.md,
            alignSelf: 'flex-start',
            borderRadius: ui.radius.pill,
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: colors.primary,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: isRefreshing ? 0.65 : 1,
          }}
        >
          <Text style={{ color: actionTextColor, fontFamily: 'NotoSansBengali', fontSize: ui.font.sm }}>
            {isRefreshing || isLoading ? t('storage.refreshing') : t('storage.refresh')}
          </Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
};
